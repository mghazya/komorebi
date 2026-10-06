/** Supabase Auth + PostgREST, using browser fetch with no runtime dependencies. */
export const AUTH_STORAGE_KEY = 'komorebi.auth.v1';

export class CloudError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.name = 'CloudError';
    this.code = code;
    this.status = status;
  }
}

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const defaultStorage = () => { try { return globalThis.localStorage; } catch { return null; } };
const safeUser = (user) => user && typeof user.id === 'string' && user.id ? user : null;

function publicConfig(config) {
  try {
    const url = new URL(String(config?.url || '').trim());
    const anonKey = String(config?.anonKey || '').trim();
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (!anonKey || (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) return null;
    if (anonKey.startsWith('sb_secret_')) return null;
    if (anonKey.split('.').length === 3) {
      try {
        const middle = anonKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(globalThis.atob(middle));
        if (payload.role && payload.role !== 'anon') return null;
      } catch { return null; }
    }
    return { url: url.href.replace(/\/+$/, ''), anonKey };
  } catch { return null; }
}

function authMessage(data, status) {
  const code = data?.error_code || data?.code;
  const known = {
    invalid_credentials: 'The email or password is incorrect.',
    email_not_confirmed: 'Confirm your email using the link in your inbox, then sign in.',
    user_already_exists: 'An account already exists for this email. Try signing in.',
    weak_password: 'Choose a stronger password that meets the project’s password requirements.',
    same_password: 'Choose a password different from your current password.',
    signup_disabled: 'New accounts are currently disabled for this app.',
    email_address_invalid: 'Enter a valid email address.',
    email_address_not_authorized: 'Email delivery is restricted. The app owner needs to configure email delivery in Supabase.',
    over_email_send_rate_limit: 'Too many emails requested. Please wait before trying again.',
    over_request_rate_limit: 'Too many requests. Please wait before trying again.',
    reauthentication_needed: 'Sign in again before changing your password.',
  };
  return known[code] || (status === 429 ? 'Too many requests. Please wait before trying again.' : 'Unable to complete authentication. Check your details and try again.');
}

/**
 * The optional dependencies argument is for deterministic tests.
 * getSession is synchronous; authenticated network methods refresh expired
 * sessions. Failed network requests preserve the previous session and profile.
 * The caller owns profile caching and must surface conflicts before retrying.
 */
export function createCloudClient(config, dependencies = {}) {
  const normalized = publicConfig(config);
  const isConfigured = Boolean(normalized);
  const fetcher = dependencies.fetch || globalThis.fetch?.bind(globalThis);
  let storage = dependencies.storage === undefined ? defaultStorage() : dependencies.storage;
  const location = dependencies.location === undefined ? globalThis.location : dependencies.location;
  const history = dependencies.history === undefined ? globalThis.history : dependencies.history;
  const locks = dependencies.locks === undefined ? globalThis.navigator?.locks : dependencies.locks;
  const now = dependencies.now || Date.now;
  let memorySession = null;
  let refreshPromise = null;

  function requireConfigured() {
    if (!isConfigured) throw new CloudError('NOT_CONFIGURED', 'Cloud accounts are not configured yet. Add the public Supabase settings in config.js.');
  }

  function getSession() {
    if (!isConfigured) return null;
    if (storage) {
      try {
        const stored = JSON.parse(storage.getItem(AUTH_STORAGE_KEY) || 'null');
        memorySession = stored?.url === normalized.url && validSession(stored.session) ? stored.session : null;
      } catch { storage = null; }
    }
    return clone(memorySession);
  }

  function validSession(candidate) {
    return Boolean(candidate && typeof candidate.access_token === 'string' && candidate.access_token &&
      typeof candidate.refresh_token === 'string' && candidate.refresh_token &&
      Number.isFinite(candidate.expires_at) && safeUser(candidate.user));
  }

  function persistSession(next) {
    memorySession = clone(next);
    if (storage) {
      try {
        if (next) storage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ version: 1, url: normalized.url, session: next }));
        else storage.removeItem(AUTH_STORAGE_KEY);
      } catch { storage = null; }
    }
    return clone(next);
  }

  function sessionFrom(data) {
    const expiresAt = Number(data?.expires_at) || Math.floor(now() / 1000) + Number(data?.expires_in || 3600);
    const candidate = {
      access_token: data?.access_token,
      refresh_token: data?.refresh_token,
      token_type: 'bearer',
      expires_at: expiresAt,
      user: data?.user,
    };
    if (!validSession(candidate)) throw new CloudError('AUTH_ERROR', 'The authentication response was incomplete. Please sign in again.');
    return candidate;
  }

  async function request(path, { method = 'GET', body, token, auth = false } = {}) {
    requireConfigured();
    const headers = { apikey: normalized.anonKey, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    // Publishable keys are not JWTs: use apikey, never Bearer <publishable key>.
    if (token) headers.Authorization = `Bearer ${token}`;
    let response;
    let data;
    try {
      response = await fetcher(normalized.url + path, {
        method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        cache: 'no-store', credentials: 'omit',
      });
      const text = await response.text();
      if (text) {
        try { data = JSON.parse(text); } catch { data = null; }
      }
    } catch {
      throw new CloudError('NETWORK_ERROR', 'Unable to reach your cloud account. Your saved progress has not been replaced. Check your connection and retry.');
    }
    if (!response.ok) {
      if (response.status === 409 || data?.code === 'PT409') throw new CloudError('CONFLICT', 'Progress changed on another device. Load the latest cloud progress before saving again.', response.status);
      if (response.status === 401 && !auth) throw new CloudError('AUTH_REQUIRED', 'Your session has expired. Please sign in again.', response.status);
      if (auth) throw new CloudError('AUTH_ERROR', authMessage(data, response.status), response.status);
      throw new CloudError('REQUEST_ERROR', response.status === 429 ? 'Too many requests. Please wait and retry.' : 'Cloud progress could not be loaded or saved. Please retry. If this continues, check the Supabase setup.', response.status);
    }
    return data ?? null;
  }

  function sameAccount(userId) {
    if (getSession()?.user.id !== userId) throw new CloudError('AUTH_CHANGED', 'The signed-in account changed in another tab. Reload before continuing.');
  }

  async function ensureSession() {
    requireConfigured();
    const current = getSession();
    if (!current) throw new CloudError('AUTH_REQUIRED', 'Sign in to use your cloud progress.');
    if (current.expires_at * 1000 > now() + 60_000) return current;
    if (!refreshPromise) {
      const refresh = async () => {
        const latest = getSession();
        if (!latest) throw new CloudError('AUTH_REQUIRED', 'Sign in to use your cloud progress.');
        if (latest.expires_at * 1000 > now() + 60_000) return latest;
        try {
          const data = await request('/auth/v1/token?grant_type=refresh_token', {
            method: 'POST', auth: true, body: { refresh_token: latest.refresh_token },
          });
          sameAccount(latest.user.id);
          const next = sessionFrom(data);
          if (next.user.id !== latest.user.id) throw new CloudError('AUTH_CHANGED', 'The cloud account changed. Please sign in again.');
          return persistSession(next);
        } catch (error) {
          // A temporary outage is not a sign-out. Invalid/revoked refresh tokens are.
          if (error.code === 'AUTH_ERROR' && [400, 401, 403].includes(error.status)) {
            if (getSession()?.user.id === latest.user.id) persistSession(null);
            throw new CloudError('AUTH_REQUIRED', 'Your session has expired. Please sign in again.', error.status);
          }
          throw error;
        }
      };
      refreshPromise = (locks?.request ? locks.request(`komorebi-auth:${normalized.url}`, refresh) : refresh())
        .finally(() => { refreshPromise = null; });
    }
    const refreshed = await refreshPromise;
    if (refreshed.user.id !== current.user.id) throw new CloudError('AUTH_CHANGED', 'The signed-in account changed. Reload before continuing.');
    return refreshed;
  }

  function redirectQuery(redirectTo) {
    if (!redirectTo) return '';
    let parsed;
    try { parsed = new URL(redirectTo); } catch { throw new CloudError('AUTH_ERROR', 'The email return URL is invalid.'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new CloudError('AUTH_ERROR', 'The email return URL must use HTTP or HTTPS.');
    parsed.hash = '';
    return `?redirect_to=${encodeURIComponent(parsed.href)}`;
  }

  async function signUp(email, password, redirectTo) {
    const data = await request('/auth/v1/signup' + redirectQuery(redirectTo), {
      method: 'POST', auth: true, body: { email: String(email).trim(), password },
    });
    if (!data?.access_token) return { session: null, requiresEmailConfirmation: true };
    return { session: persistSession(sessionFrom(data)), requiresEmailConfirmation: false };
  }

  async function signIn(email, password) {
    const data = await request('/auth/v1/token?grant_type=password', {
      method: 'POST', auth: true, body: { email: String(email).trim(), password },
    });
    return persistSession(sessionFrom(data));
  }

  async function signOut() {
    if (!getSession()) return;
    let session;
    try {
      session = await ensureSession();
    } catch (error) {
      // ensureSession already clears revoked/expired refresh tokens as AUTH_REQUIRED.
      // Treat that as a completed local sign-out so the UI can drop cloud state.
      if (error.code === 'AUTH_REQUIRED') return;
      throw error;
    }
    try {
      await request('/auth/v1/logout?scope=local', { method: 'POST', token: session.access_token, auth: true });
    } catch (error) {
      // An already invalid token is also safe to discard; outages stay visible.
      if (![401, 403].includes(error.status)) throw error;
    }
    sameAccount(session.user.id);
    persistSession(null);
  }

  async function loadProfile() {
    const session = await ensureSession();
    const query = new URLSearchParams({ user_id: `eq.${session.user.id}`, select: 'profile,revision', limit: '1' });
    const data = await request('/rest/v1/learner_progress?' + query, { token: session.access_token });
    sameAccount(session.user.id);
    if (!Array.isArray(data)) throw new CloudError('REQUEST_ERROR', 'Cloud progress returned an unexpected response. Your local progress is unchanged.');
    if (!data.length) return null;
    return profileResult(data[0]);
  }

  function profileResult(row) {
    if (!row || !row.profile || typeof row.profile !== 'object' || Array.isArray(row.profile) || !Number.isInteger(row.revision) || row.revision < 1) {
      throw new CloudError('REQUEST_ERROR', 'Cloud progress returned an unexpected response. Your local progress is unchanged.');
    }
    return { profile: row.profile, revision: row.revision };
  }

  async function saveProfile(profile, expectedRevision) {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile) || !Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new CloudError('REQUEST_ERROR', 'A profile and its current revision are required before saving.');
    }
    const session = await ensureSession();
    const data = await request('/rest/v1/rpc/save_learner_progress', {
      method: 'POST', token: session.access_token,
      body: { payload: profile, expected_revision: expectedRevision },
    });
    sameAccount(session.user.id);
    return profileResult(Array.isArray(data) ? data[0] : data);
  }

  async function requestPasswordReset(email, redirectTo) {
    await request('/auth/v1/recover' + redirectQuery(redirectTo), {
      method: 'POST', auth: true, body: { email: String(email).trim() },
    });
    return { sent: true };
  }

  async function updatePassword(password) {
    const session = await ensureSession();
    const user = await request('/auth/v1/user', { method: 'PUT', auth: true, token: session.access_token, body: { password } });
    sameAccount(session.user.id);
    if (!safeUser(user) || user.id !== session.user.id) throw new CloudError('AUTH_ERROR', 'The password update returned an unexpected response. Please sign in again.');
    return persistSession({ ...getSession(), user });
  }

  async function initializeFromUrl() {
    const params = new URLSearchParams(String(location?.hash || '').replace(/^#/, ''));
    const hasAuth = ['access_token', 'refresh_token', 'error', 'error_code', 'error_description'].some((key) => params.has(key));
    if (!hasAuth) return null;
    // Remove sensitive tokens immediately, even when the link is malformed.
    if (history?.replaceState && location) history.replaceState(history.state, '', `${location.pathname || '/'}${location.search || ''}`);
    requireConfigured();
    if (params.has('error') || params.has('error_code')) throw new CloudError('AUTH_ERROR', 'This email link is invalid or expired. Request a new link and try again.');
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (!accessToken || !refreshToken) throw new CloudError('AUTH_ERROR', 'This email link is incomplete. Request a new link and try again.');
    // The URL is untrusted: never accept a decoded JWT alone as a verified user.
    const user = await request('/auth/v1/user', { token: accessToken, auth: true });
    // Validate the refresh token too and store its rotated successor. A token
    // pair assembled from different accounts must never establish a session.
    const refreshed = await request('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', auth: true, body: { refresh_token: refreshToken },
    });
    const session = sessionFrom(refreshed);
    if (session.user.id !== user?.id) throw new CloudError('AUTH_ERROR', 'This email link contains an invalid session. Request a new link and try again.');
    persistSession(session);
    return { session: clone(session), recovery: params.get('type') === 'recovery' };
  }

  return Object.freeze({ isConfigured, signUp, signIn, signOut, getSession, loadProfile, saveProfile, requestPasswordReset, updatePassword, initializeFromUrl });
}

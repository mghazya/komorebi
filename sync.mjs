/**
 * Account-scoped cloud progress state (profile, revision, error, pending draft).
 * Every account transition resets the in-memory state, drafts are stored and restored only
 * under their owner's ID, the authenticated ID is checked against the draft owner right before
 * and after a save, and results from a previous account (stale async work) are ignored.
 * REVIEW-2026-10-06 P1.
 */
export const DRAFT_KEY = 'komorebi.cloud-draft.v1';

export function createCloudSync({ cloud, storage, validate, emptyProfile, hooks = {} }) {
  const h = { setBusy() {}, isBusy: () => false, onChange() {}, onSaveError() {}, onDraftError() {}, ...hooks };
  const state = { profile: null, revision: 0, error: '', errorCode: '', pending: null, ownerId: null, placeholder: false };
  let epoch = 0;
  /** When connect() is requested while busy (e.g. account switch mid-load), retry once work settles. */
  let pendingConnect = false;
  const store = () => { try { return storage === undefined ? globalThis.localStorage : storage; } catch { return null; } };
  const keyFor = (userId) => `${DRAFT_KEY}:${userId}`;
  const currentUserId = () => cloud.getSession()?.user?.id || null;

  function reset(ownerId = null) {
    epoch += 1;
    Object.assign(state, { profile: null, revision: 0, error: '', errorCode: '', pending: null, ownerId, placeholder: false });
  }

  function saveDraft() {
    if (!state.pending) return true;
    try { store().setItem(keyFor(state.pending.userId), JSON.stringify(state.pending)); return true; } catch { return false; }
  }

  function readDraft(userId) {
    let draft;
    try { draft = JSON.parse(store()?.getItem(keyFor(userId)) || 'null'); } catch { return null; }
    if (!draft || draft.userId !== userId || !Number.isInteger(draft.revision) || draft.revision < 0) return null;
    if (draft.profile?.id !== undefined && draft.profile.id !== userId) return null; // never adopt another account's data
    try {
      const profile = validate(draft.profile);
      profile.id = userId;
      return { userId, profile, revision: draft.revision };
    } catch { return null; }
  }

  function clearDraft(userId) {
    try { store()?.removeItem(keyFor(userId)); } catch { /* ignore */ }
    if (state.pending?.userId === userId) state.pending = null;
  }

  function placeholderFor(user) {
    const profile = emptyProfile(user);
    profile.id = user.id;
    return profile;
  }

  async function settle() {
    h.setBusy(false);
    h.onChange();
    if (!pendingConnect) return;
    pendingConnect = false;
    await connect();
  }

  async function connect() {
    if (h.isBusy()) { pendingConnect = true; return; }
    const auth = cloud.getSession();
    if (!auth) { pendingConnect = false; reset(null); h.onChange(); return; }
    const userId = auth.user.id;
    if (state.ownerId !== userId) reset(userId);
    const mine = ++epoch;
    h.setBusy(true, 'Loading your study space…');
    try {
      const record = await cloud.loadProfile();
      if (mine !== epoch || currentUserId() !== userId) return;
      const profile = record ? validate(record.profile) : placeholderFor(auth.user);
      profile.id = userId;
      Object.assign(state, { profile, revision: record?.revision || 0, error: '', errorCode: '', placeholder: false });
      const draft = readDraft(userId);
      if (draft) {
        Object.assign(state, { pending: draft, profile: draft.profile, error: 'Some progress from a previous visit still needs to be synced.', errorCode: 'PENDING' });
      }
    } catch (error) {
      if (mine !== epoch || currentUserId() !== userId) return;
      state.error = error.message || 'Cloud progress could not be loaded.';
      state.errorCode = error.code || 'ERROR';
      if (!state.profile) { state.profile = placeholderFor(auth.user); state.placeholder = true; }
    } finally {
      await settle();
    }
  }

  async function push() {
    if (!state.pending || h.isBusy()) return false;
    const draft = JSON.parse(JSON.stringify(state.pending));
    if (currentUserId() !== draft.userId || state.ownerId !== draft.userId || draft.profile?.id !== draft.userId) {
      state.error = 'Sign in again as the account that owns this progress.';
      state.errorCode = 'AUTH_REQUIRED';
      h.onChange();
      return false;
    }
    const mine = epoch;
    h.setBusy(true);
    try {
      const result = await cloud.saveProfile(draft.profile, draft.revision);
      if (mine !== epoch || currentUserId() !== draft.userId) return false; // stale: the draft stays stored under its owner
      const profile = validate(result.profile);
      profile.id = draft.userId;
      Object.assign(state, { profile, revision: result.revision, error: '', errorCode: '', placeholder: false });
      clearDraft(draft.userId);
      return true;
    } catch (error) {
      if (mine === epoch && (!currentUserId() || currentUserId() === draft.userId)) {
        Object.assign(state, { profile: draft.profile, error: error.message || 'Saving failed.', errorCode: error.code || 'ERROR' });
      }
      h.onSaveError(error);
      return false;
    } finally {
      await settle();
    }
  }

  /** Returns true/false, or 'blocked' when a busy/error/placeholder state forbids saving. */
  async function update(profile) {
    const auth = cloud.getSession();
    if (!state.profile) return 'blocked';
    if (!auth || auth.user.id !== state.ownerId || state.profile.id !== auth.user.id) {
      state.error = 'Sign in again to save your cloud progress.';
      state.errorCode = 'AUTH_REQUIRED';
      h.onChange();
      return false;
    }
    if (h.isBusy() || state.error || state.placeholder) return 'blocked';
    state.pending = { userId: auth.user.id, profile: { ...profile, id: auth.user.id }, revision: state.revision };
    if (!saveDraft()) h.onDraftError();
    return push();
  }

  async function retry() {
    if (state.pending && state.pending.userId === currentUserId()) return push();
    return connect();
  }

  async function reload() {
    const id = currentUserId();
    if (id) clearDraft(id);
    await connect();
  }

  return Object.freeze({ state, reset, connect, push, update, retry, reload, readDraft, clearDraft });
}

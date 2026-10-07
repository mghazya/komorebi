/**
 * Lossless learner-profile validation. A valid profile is returned as an exact deep copy:
 * no defaults are filled in, no fields are dropped, and subject IDs that this version of the
 * curriculum does not know (future levels, levels that failed to load) are kept as they are.
 * Only structurally broken data is rejected. Saving happens elsewhere, and only after a
 * learning event or an explicit user action, so loading never rewrites a stored profile.
 */
export const MAX_NAME_LENGTH = 50;
export const BATCH_SIZES = Object.freeze([3, 5, 10]);

export class ProfileError extends Error {
  constructor(message) { super(message); this.name = 'ProfileError'; this.code = 'INVALID_PROFILE'; }
}

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const deepCopy = (value) => JSON.parse(JSON.stringify(value));

export function validateProfile(value) {
  if (!isPlainObject(value) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > MAX_NAME_LENGTH || !isPlainObject(value.progress)) {
    throw new ProfileError('This is not a valid Komorebi backup.');
  }
  if (value.id !== undefined && typeof value.id !== 'string') throw new ProfileError('This is not a valid Komorebi backup.');
  for (const [id, entry] of Object.entries(value.progress)) {
    if (!id || !isPlainObject(entry) || !Number.isInteger(entry.stage) || entry.stage < 1 || entry.stage > 9 ||
      (entry.stage < 9 && (!Number.isFinite(entry.availableAt) || entry.availableAt < 0))) {
      throw new ProfileError('This backup contains invalid review dates or stages.');
    }
  }
  if (value.unlockedLevel !== undefined && (!Number.isInteger(value.unlockedLevel) || value.unlockedLevel < 1)) {
    throw new ProfileError('This backup contains an invalid level.');
  }
  return deepCopy(value);
}

export const batchSizeOf = (profile) => BATCH_SIZES.includes(profile?.settings?.batchSize) ? profile.settings.batchSize : 5;

/** Progress IDs that the loaded curriculum does not contain (kept, never deleted). */
export function unknownProgressIds(profile, knownIds) {
  return Object.keys(profile?.progress || {}).filter((id) => !knownIds.has(id));
}

/** Pretty-printed full-course backups are ~2.7 MB; 8 MB leaves headroom for extra fields. */
export const BACKUP_MAX_BYTES = 8_000_000;
export const BACKUP_APP = 'komorebi';
export const BACKUP_VERSION = 1;

/** Serialize a learner profile the same way Settings → Export does (pretty-printed). */
export function serializeBackup(profile, { exportedAt = new Date().toISOString() } = {}) {
  return `${JSON.stringify({ app: BACKUP_APP, version: BACKUP_VERSION, exportedAt, profile }, null, 2)}\n`;
}

/** Validate a parsed backup document and return a lossless profile copy. */
export function parseBackupDocument(data) {
  if (!data || data.app !== BACKUP_APP || data.version !== BACKUP_VERSION) {
    throw new ProfileError('Please choose a Komorebi progress backup.');
  }
  return validateProfile(data.profile);
}

/**
 * Read a File-like backup ({ size, text() }) through the real size check + parse path.
 * Oversized or invalid input throws; the caller leaves existing progress untouched.
 */
export async function readBackupFile(file) {
  if (!file) throw new ProfileError('Please choose a Komorebi progress backup.');
  if (!Number.isFinite(file.size) || file.size < 0) throw new ProfileError('Please choose a Komorebi progress backup.');
  if (file.size > BACKUP_MAX_BYTES) {
    throw new ProfileError(`Please choose a Komorebi backup smaller than ${BACKUP_MAX_BYTES / 1_000_000} MB.`);
  }
  let data;
  try { data = JSON.parse(await file.text()); }
  catch { throw new ProfileError('That backup could not be imported. Your progress is unchanged.'); }
  return parseBackupDocument(data);
}

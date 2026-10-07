/**
 * Manifest-driven curriculum loading (data contract v1, TEAM_PLAN.md).
 * - dist/data/manifest.json lists the validated levels; each level file is a flat JSON array.
 * - No manifest (HTTP 404) → legacy mode: ./data/level-1.json only.
 * - Each level loads independently. A level that fails (network, bad JSON, count or sha256
 *   mismatch) is reported as failed; the rest stay usable. Nothing here touches progress.
 * - The known-ID registry is every subject ID from the levels that loaded. Progress for IDs
 *   outside it is preserved by the app, never deleted.
 * Downloaded JSON is data only: it is validated and later escaped at render time.
 */
export const MANIFEST_PATH = './data/manifest.json';
export const LEGACY_LEVEL_PATH = './data/level-1.json';
export const SUBJECT_TYPES = Object.freeze(['radical', 'kanji', 'vocabulary']);

export class CurriculumError extends Error {
  constructor(message, code = 'CURRICULUM_ERROR') { super(message); this.name = 'CurriculumError'; this.code = code; }
}

const DATA_PATH = /^\.\/data\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.json$/;
const IMAGE_PATH = /^\.\/data\/radicals\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.svg$/;
export const isSafeDataPath = (path) => typeof path === 'string' && DATA_PATH.test(path);
export const isSafeImagePath = (path) => typeof path === 'string' && IMAGE_PATH.test(path);

export function parseManifest(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.schemaVersion !== 1 || !Array.isArray(data.levels) || !data.levels.length) {
    throw new CurriculumError('The curriculum manifest is not a supported version.', 'BAD_MANIFEST');
  }
  const seen = new Set();
  const levels = data.levels.map((entry) => {
    if (!entry || !Number.isInteger(entry.level) || entry.level < 1 || seen.has(entry.level) || !isSafeDataPath(entry.path) ||
      !Number.isInteger(entry.itemCount) || entry.itemCount < 0) {
      throw new CurriculumError('The curriculum manifest has an invalid level entry.', 'BAD_MANIFEST');
    }
    seen.add(entry.level);
    const counts = entry.counts && typeof entry.counts === 'object' ? { ...entry.counts } : null;
    const sha256 = typeof entry.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(entry.sha256) ? entry.sha256.toLowerCase() : null;
    return { level: entry.level, path: entry.path, itemCount: entry.itemCount, counts, sha256 };
  }).sort((a, b) => a.level - b.level);
  return { schemaVersion: 1, datasetVersion: typeof data.datasetVersion === 'string' ? data.datasetVersion : '', levels };
}

/** Structural checks for one level file against its manifest entry. Returns a list of problems. */
export function checkLevelItems(items, entry) {
  if (!Array.isArray(items)) return ['level file is not an array'];
  const problems = [];
  if (items.length !== entry.itemCount) problems.push(`expected ${entry.itemCount} subjects, found ${items.length}`);
  const ids = new Set();
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !item.id || typeof item.type !== 'string') { problems.push('subject without id/type'); break; }
    if (ids.has(item.id)) problems.push(`duplicate id ${item.id}`);
    ids.add(item.id);
    if (item.level !== entry.level) { problems.push(`${item.id} has level ${item.level}`); break; }
    if (typeof item.meaning !== 'string' || !Array.isArray(item.meanings)) { problems.push(`${item.id} has no meanings`); break; }
    if (!item.character && !isSafeImagePath(item.characterImage)) { problems.push(`${item.id} has no glyph`); break; }
  }
  if (entry.counts) {
    for (const [type, count] of Object.entries(entry.counts)) {
      const actual = items.filter((item) => item?.type === type).length;
      if (actual !== count) problems.push(`expected ${count} ${type}, found ${actual}`);
    }
  }
  return problems;
}

async function defaultDigest(buffer) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const hash = await subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function mapLimit(values, limit, fn) {
  const results = new Array(values.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) { const index = next++; results[index] = await fn(values[index], index); }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Loads the curriculum. Throws CurriculumError only when nothing usable can be loaded
 * (manifest unreachable/invalid, or every level failed). Otherwise returns:
 * { mode, datasetVersion, levels: [{level, path, itemCount, counts, status, problems}],
 *   items, knownIds, availableLevels, loadedLevels, failedLevels, counts, imagePaths, warnings }
 */
export async function loadCurriculum({ fetch = globalThis.fetch?.bind(globalThis), digest = defaultDigest, concurrency = 6 } = {}) {
  let manifest;
  let mode = 'manifest';
  let response;
  try {
    response = await fetch(MANIFEST_PATH, { cache: 'no-cache' });
  } catch {
    throw new CurriculumError('Study data could not be loaded. Check your connection and try again.', 'NETWORK');
  }
  if (response.status === 404) {
    mode = 'legacy';
    manifest = { schemaVersion: 1, datasetVersion: 'legacy-level-1', levels: [{ level: 1, path: LEGACY_LEVEL_PATH, itemCount: null, counts: null, sha256: null }] };
  } else if (!response.ok) {
    throw new CurriculumError('Study data could not be loaded. Please try again.', 'NETWORK');
  } else {
    let data;
    try { data = await response.json(); } catch { throw new CurriculumError('The curriculum manifest could not be read.', 'BAD_MANIFEST'); }
    manifest = parseManifest(data);
  }

  const loaded = await mapLimit(manifest.levels, concurrency, async (entry) => {
    try {
      const res = await fetch(entry.path, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = await res.arrayBuffer();
      if (entry.sha256 && digest) {
        const actual = await digest(buffer);
        if (actual && actual !== entry.sha256) throw new Error('sha256 does not match the manifest');
      }
      const items = JSON.parse(new TextDecoder().decode(buffer));
      const check = entry.itemCount == null ? { ...entry, itemCount: Array.isArray(items) ? items.length : -1 } : entry;
      const problems = checkLevelItems(items, check);
      if (problems.length) throw new Error(problems.slice(0, 3).join('; '));
      return { ...check, status: 'loaded', problems: [], items };
    } catch (error) {
      return { ...entry, status: 'failed', problems: [String(error?.message || error)], items: [] };
    }
  });

  const items = [];
  const knownIds = new Set();
  const warnings = [];
  for (const level of loaded) {
    for (const item of level.items) {
      if (knownIds.has(item.id)) { warnings.push(`Duplicate subject ${item.id} in level ${level.level} was skipped.`); continue; }
      knownIds.add(item.id);
      items.push(item);
    }
  }
  const loadedLevels = loaded.filter((l) => l.status === 'loaded').map((l) => l.level);
  if (!loadedLevels.length) throw new CurriculumError('Study data could not be loaded. Please try again.', 'NO_LEVELS');
  const counts = { total: items.length };
  for (const type of SUBJECT_TYPES) counts[type] = items.filter((i) => i.type === type).length;
  const imagePaths = new Set();
  for (const item of items) {
    if (isSafeImagePath(item.characterImage)) imagePaths.add(item.characterImage);
    for (const c of item.components || []) if (isSafeImagePath(c?.characterImage)) imagePaths.add(c.characterImage);
  }
  return {
    mode,
    datasetVersion: manifest.datasetVersion,
    levels: loaded.map(({ items: _items, ...rest }) => rest),
    items,
    knownIds,
    availableLevels: manifest.levels.map((l) => l.level),
    loadedLevels,
    failedLevels: loaded.filter((l) => l.status === 'failed').map((l) => l.level),
    counts,
    imagePaths: [...imagePaths],
    warnings,
  };
}

/**
 * Accepts an SVG only when it is self-contained and inert: no scripts, event handlers,
 * foreignObject, external references, entities or CSS imports. Returns the text or null.
 * The app additionally renders it through <img src="data:…">, where browsers never run
 * scripts or fetch external resources.
 */
export function sanitizeSvg(text) {
  if (typeof text !== 'string' || text.length > 200_000) return null;
  const svg = text.replace(/^\uFEFF/, '').trim();
  if (!/^(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) return null;
  const forbidden = [
    /<script/i, /<foreignObject/i, /<iframe/i, /<embed/i, /<object/i, /<!DOCTYPE/i, /<!ENTITY/i,
    /\son[a-z]+\s*=/i, /javascript:/i, /data:/i, /@import/i,
    /(?:xlink:)?href\s*=\s*["']\s*(?!#)/i, /url\(\s*["']?\s*(?!#)/i,
  ];
  return forbidden.some((pattern) => pattern.test(svg)) ? null : svg;
}

export const svgDataUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

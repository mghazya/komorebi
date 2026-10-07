/**
 * Komorebi's WaniKani-inspired learning engine. No storage or DOM dependencies.
 *
 * SRS timing follows WaniKani's published stages (knowledge.wanikani.com/wanikani/srs-stages/,
 * checked 2026-10-06): subjects from Levels 1–2 use accelerated Apprentice waits
 * (2h, 4h, 8h, 1d); later levels use 4h, 8h, 1d, 2d. Guru onward is shared: 1 week,
 * 2 weeks, 1 month (fixed at 30 days), 4 months (fixed at 120 days). Delays are the
 * wait AFTER entering each stage. The timing is chosen by the subject's own level at
 * the moment a lesson/review is recorded; stored due dates are never recomputed.
 * An item must reach Guru once to unlock its dependents; later mistakes never undo that
 * unlock. A level unlocks once ceil(90%) of the previous level's kanji reached Guru once.
 * Meaning + reading form one review. Pass mistakes for both questions combined.
 */
export const STAGE_NAMES = Object.freeze([
  'Not started', 'Apprentice I', 'Apprentice II', 'Apprentice III',
  'Apprentice IV', 'Guru I', 'Guru II', 'Master', 'Enlightened', 'Burned',
]);

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** Accelerated schedule (Levels 1–2). Kept under its historical name for compatibility. */
export const STAGE_INTERVALS = Object.freeze([
  0, 2 * HOUR, 4 * HOUR, 8 * HOUR, DAY, 7 * DAY,
  14 * DAY, 30 * DAY, 120 * DAY, null,
]);
export const ACCELERATED_INTERVALS = STAGE_INTERVALS;
/** Standard schedule (Level 3 and above). */
export const STANDARD_INTERVALS = Object.freeze([
  0, 4 * HOUR, 8 * HOUR, DAY, 2 * DAY, 7 * DAY,
  14 * DAY, 30 * DAY, 120 * DAY, null,
]);
export const ACCELERATED_MAX_LEVEL = 2;
export const LEVEL_UNLOCK_RATIO = 0.9;
export const HISTORY_LIMIT = 5000;

/** Wait after entering `stage` for a subject of `level`. Unknown level → accelerated (legacy Level 1 behaviour). */
export function intervalFor(stage, level) {
  const table = Number.isInteger(level) && level > ACCELERATED_MAX_LEVEL ? STANDARD_INTERVALS : ACCELERATED_INTERVALS;
  return table[stage] ?? null;
}

const levelFrom = (levelOf, id) => {
  const value = typeof levelOf === 'function' ? levelOf(id) : levelOf && typeof levelOf === 'object' ? levelOf[id] : undefined;
  return Number.isInteger(value) ? value : undefined;
};
const historyOf = (profile) => Array.isArray(profile?.history) ? profile.history : [];
const appendHistory = (profile, entry) => [...historyOf(profile), entry].slice(-HISTORY_LIMIT);

export function newProfile(name = 'Learner', id) {
  return {
    id: id || globalThis.crypto?.randomUUID?.() || `learner-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: String(name).trim() || 'Learner',
    createdAt: Date.now(),
    progress: {},
    history: [],
    settings: { batchSize: 5 },
  };
}

const progressOf = (profile) => profile?.progress || {};
export const hasPassed = (record) => Boolean(record && (record.stage >= 5 || record.passedAt != null));
const depId = (dep) => typeof dep === 'string' ? dep : dep?.id;

/**
 * ctx.maxLevel (optional): the learner's actual level. A not-yet-started subject above it is
 * locked (levelLocked). Started subjects are never re-locked. Dependencies are global IDs, so
 * prerequisites from other levels are checked through the shared progress map.
 */
export function statusFor(item, profile, now = Date.now(), ctx = {}) {
  const record = progressOf(profile)[item.id];
  const stage = record?.stage || 0;
  const unmetDependencies = (item.dependencies || []).map(depId).filter((id) => id && !hasPassed(progressOf(profile)[id]));
  const levelLocked = stage === 0 && Number.isInteger(ctx?.maxLevel) && Number.isInteger(item.level) && item.level > ctx.maxLevel;
  let state;
  if (stage >= 9) state = 'burned';
  else if (stage > 0) state = record.availableAt <= now ? 'review' : 'learning';
  else state = unmetDependencies.length || levelLocked ? 'locked' : 'lesson';
  return {
    state,
    stage,
    stageName: STAGE_NAMES[stage] || STAGE_NAMES[0],
    availableAt: stage > 0 && stage < 9 ? record.availableAt : null,
    unmetDependencies,
    levelLocked,
  };
}

/** Kanji progress of one level and the number needed (ceil 90%) to unlock the next level. */
export function levelProgress(items, profile, level) {
  const kanji = items.filter((item) => item.type === 'kanji' && item.level === level);
  const kanjiPassed = kanji.filter((item) => hasPassed(progressOf(profile)[item.id])).length;
  return { level, kanjiTotal: kanji.length, kanjiPassed, required: levelUnlockThreshold(kanji.length) };
}

/** ceil(90%): 17 of 18, 27 of 30, 0 of 0. */
export function levelUnlockThreshold(kanjiTotal) {
  // Integer arithmetic avoids floating-point surprises such as 0.9 * 10 = 9.000000000000002.
  return Math.ceil((kanjiTotal * 9) / 10);
}

const storedLevel = (profile) => Number.isInteger(profile?.unlockedLevel) ? profile.unlockedLevel : 0;

/**
 * The learner's actual level. Walks the available levels in order: the next level is unlocked
 * when it was recorded as earned (profile.unlockedLevel, permanent) or when the current level's
 * kanji meet the 90 % rule. Guru is judged by passedAt/stage>=5, so later demotion never re-locks.
 * A level whose data failed to load cannot be judged; only a recorded unlock passes it.
 * options.levels: available level numbers (default: levels present in items).
 * options.loadedLevels: levels whose data loaded (default: levels present in items).
 */
export function learnerLevel(items, profile, options = {}) {
  const present = [...new Set(items.map((item) => item.level).filter(Number.isInteger))].sort((a, b) => a - b);
  const levels = (options.levels?.length ? [...options.levels] : present).filter(Number.isInteger).sort((a, b) => a - b);
  if (!levels.length) return 1;
  const loaded = options.loadedLevels ? new Set(options.loadedLevels) : new Set(present);
  const stored = storedLevel(profile);
  let level = levels[0];
  for (let i = 0; i < levels.length - 1; i++) {
    const next = levels[i + 1];
    let unlocked = stored >= next;
    if (!unlocked && loaded.has(levels[i])) {
      const progress = levelProgress(items, profile, levels[i]);
      unlocked = progress.kanjiPassed >= progress.required;
    }
    if (!unlocked) break;
    level = next;
  }
  return level;
}

/** Record an earned level permanently. Returns the same object when nothing changes. */
export function recordLevelUnlock(profile, level) {
  if (!Number.isInteger(level) || level <= 1 || level <= storedLevel(profile)) return profile;
  return { ...profile, unlockedLevel: level };
}

/**
 * Lessons whose prerequisites are met, from levels up to ctx.maxLevel (default: the derived
 * learner level for these items), lower levels first.
 */
export function availableLessons(items, profile, ctx) {
  const maxLevel = Number.isInteger(ctx?.maxLevel) ? ctx.maxLevel : learnerLevel(items, profile);
  return items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => statusFor(item, profile, Date.now(), { maxLevel }).state === 'lesson')
    .sort((a, b) => ((a.item.level ?? 0) - (b.item.level ?? 0)) || (a.index - b.index))
    .map(({ item }) => item);
}

export function dueReviews(items, profile, now = Date.now()) {
  return items
    .filter((item) => statusFor(item, profile, now).state === 'review')
    .sort((a, b) => progressOf(profile)[a.id].availableAt - progressOf(profile)[b.id].availableAt);
}

/**
 * Start only quiz-completed lessons. The caller supplies available subject IDs.
 * levelOf (optional): id → subject level (function or map) to choose the SRS timing.
 */
export function startLearning(profile, itemIds, now = Date.now(), levelOf) {
  const freshIds = [...new Set(itemIds)].filter((id) => !progressOf(profile)[id]?.stage);
  if (!freshIds.length) return profile;
  const progress = { ...progressOf(profile) };
  for (const id of freshIds) {
    progress[id] = {
      stage: 1,
      availableAt: now + intervalFor(1, levelFrom(levelOf, id)),
      startedAt: now,
      lastReviewedAt: null,
      correctReviews: 0,
      incorrectReviews: 0,
      passedAt: null,
    };
  }
  return {
    ...profile,
    progress,
    history: appendHistory(profile, { type: 'lesson', at: now, itemIds: freshIds }),
  };
}

/**
 * A perfect review advances one stage. Otherwise lose ceil(mistakes / 2)
 * stages while Apprentice, twice that many from Guru onward, with a floor of 1.
 * Calling this again before the next due time is an intentional no-op.
 */
export function completeReview(profile, id, { mistakes = 0, level } = {}, now = Date.now()) {
  const previous = progressOf(profile)[id];
  if (!previous || previous.stage < 1 || previous.stage >= 9 || previous.availableAt > now) return profile;
  if (!Number.isInteger(mistakes) || mistakes < 0) throw new RangeError('mistakes must be a non-negative integer');
  const correct = mistakes === 0;
  const penalty = Math.ceil(mistakes / 2) * (previous.stage >= 5 ? 2 : 1);
  const stage = correct ? Math.min(9, previous.stage + 1) : Math.max(1, previous.stage - penalty);
  const next = {
    ...previous,
    stage,
    availableAt: stage === 9 ? null : now + intervalFor(stage, Number.isInteger(level) ? level : undefined),
    lastReviewedAt: now,
    correctReviews: (previous.correctReviews || 0) + Number(correct),
    incorrectReviews: (previous.incorrectReviews || 0) + Number(!correct),
    passedAt: previous.passedAt ?? (previous.stage >= 5 || stage >= 5 ? now : null),
  };
  return {
    ...profile,
    progress: { ...progressOf(profile), [id]: next },
    history: appendHistory(profile, {
      type: 'review', at: now, itemId: id,
      fromStage: previous.stage, toStage: stage, mistakes, correct,
    }),
  };
}

export function stats(items, profile, now = Date.now(), ctx = {}) {
  const result = {
    total: items.length, lessons: 0, reviews: 0, locked: 0, learned: 0,
    burned: 0, stages: Array(10).fill(0), nextReviewAt: null,
    byType: {}, correctReviews: 0, incorrectReviews: 0, accuracy: null,
  };
  for (const item of items) {
    const status = statusFor(item, profile, now, ctx);
    const group = result.byType[item.type] ||= { total: 0, learned: 0, passed: 0, burned: 0 };
    group.total += 1;
    result.stages[status.stage] += 1;
    if (status.state === 'lesson') result.lessons += 1;
    if (status.state === 'review') result.reviews += 1;
    if (status.state === 'locked') result.locked += 1;
    if (status.stage > 0) { result.learned += 1; group.learned += 1; }
    if (status.state === 'burned') { result.burned += 1; group.burned += 1; }
    const record = progressOf(profile)[item.id];
    if (hasPassed(record)) group.passed += 1;
    result.correctReviews += record?.correctReviews || 0;
    result.incorrectReviews += record?.incorrectReviews || 0;
    if (status.availableAt != null && (result.nextReviewAt == null || status.availableAt < result.nextReviewAt)) {
      result.nextReviewAt = status.availableAt;
    }
  }
  const reviews = result.correctReviews + result.incorrectReviews;
  if (reviews) result.accuracy = Math.round(100 * result.correctReviews / reviews);
  return result;
}

/** Exact normalized matches only: no edit-distance guesses or semantic fuzzing. */
export function normalizeMeaning(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const ROMAJI = Object.freeze({
  a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お',
  ka: 'か', ki: 'き', ku: 'く', ke: 'け', ko: 'こ',
  ga: 'が', gi: 'ぎ', gu: 'ぐ', ge: 'げ', go: 'ご',
  sa: 'さ', si: 'し', shi: 'し', su: 'す', se: 'せ', so: 'そ',
  za: 'ざ', zi: 'じ', ji: 'じ', zu: 'ず', ze: 'ぜ', zo: 'ぞ',
  ta: 'た', ti: 'ち', chi: 'ち', tu: 'つ', tsu: 'つ', te: 'て', to: 'と',
  da: 'だ', di: 'ぢ', du: 'づ', de: 'で', do: 'ど',
  na: 'な', ni: 'に', nu: 'ぬ', ne: 'ね', no: 'の',
  ha: 'は', hi: 'ひ', hu: 'ふ', fu: 'ふ', he: 'へ', ho: 'ほ',
  ba: 'ば', bi: 'び', bu: 'ぶ', be: 'べ', bo: 'ぼ',
  pa: 'ぱ', pi: 'ぴ', pu: 'ぷ', pe: 'ぺ', po: 'ぽ',
  ma: 'ま', mi: 'み', mu: 'む', me: 'め', mo: 'も',
  ya: 'や', yu: 'ゆ', yo: 'よ',
  ra: 'ら', ri: 'り', ru: 'る', re: 'れ', ro: 'ろ',
  wa: 'わ', wo: 'を', wi: 'うぃ', we: 'うぇ',
  kya: 'きゃ', kyu: 'きゅ', kyo: 'きょ',
  gya: 'ぎゃ', gyu: 'ぎゅ', gyo: 'ぎょ',
  sha: 'しゃ', shu: 'しゅ', sho: 'しょ', she: 'しぇ',
  sya: 'しゃ', syu: 'しゅ', syo: 'しょ', sye: 'しぇ',
  ja: 'じゃ', ju: 'じゅ', jo: 'じょ', je: 'じぇ',
  jya: 'じゃ', jyu: 'じゅ', jyo: 'じょ', jye: 'じぇ',
  zya: 'じゃ', zyu: 'じゅ', zyo: 'じょ', zye: 'じぇ',
  cha: 'ちゃ', chu: 'ちゅ', cho: 'ちょ', che: 'ちぇ',
  cya: 'ちゃ', cyu: 'ちゅ', cyo: 'ちょ', cye: 'ちぇ',
  tya: 'ちゃ', tyu: 'ちゅ', tyo: 'ちょ', tye: 'ちぇ',
  dya: 'ぢゃ', dyu: 'ぢゅ', dyo: 'ぢょ', dye: 'ぢぇ',
  nya: 'にゃ', nyu: 'にゅ', nyo: 'にょ', nye: 'にぇ',
  hya: 'ひゃ', hyu: 'ひゅ', hyo: 'ひょ', hye: 'ひぇ',
  bya: 'びゃ', byu: 'びゅ', byo: 'びょ', bye: 'びぇ',
  pya: 'ぴゃ', pyu: 'ぴゅ', pyo: 'ぴょ', pye: 'ぴぇ',
  mya: 'みゃ', myu: 'みゅ', myo: 'みょ', mye: 'みぇ',
  rya: 'りゃ', ryu: 'りゅ', ryo: 'りょ', rye: 'りぇ',
  fa: 'ふぁ', fi: 'ふぃ', fe: 'ふぇ', fo: 'ふぉ', fya: 'ふゃ', fyu: 'ふゅ', fyo: 'ふょ',
  va: 'ゔぁ', vi: 'ゔぃ', vu: 'ゔ', ve: 'ゔぇ', vo: 'ゔぉ', vya: 'ゔゃ', vyu: 'ゔゅ', vyo: 'ゔょ',
  tsa: 'つぁ', tsi: 'つぃ', tse: 'つぇ', tso: 'つぉ',
  tha: 'てゃ', thi: 'てぃ', thu: 'てゅ', the: 'てぇ', tho: 'てょ',
  dha: 'でゃ', dhi: 'でぃ', dhu: 'でゅ', dhe: 'でぇ', dho: 'でょ',
  twa: 'とぁ', twi: 'とぃ', twu: 'とぅ', twe: 'とぇ', two: 'とぉ',
  dwa: 'どぁ', dwi: 'どぃ', dwu: 'どぅ', dwe: 'どぇ', dwo: 'どぉ',
  kwa: 'くぁ', kwi: 'くぃ', kwu: 'くぅ', kwe: 'くぇ', kwo: 'くぉ',
  gwa: 'ぐぁ', gwi: 'ぐぃ', gwu: 'ぐぅ', gwe: 'ぐぇ', gwo: 'ぐぉ',
  qa: 'くぁ', qi: 'くぃ', qu: 'く', qe: 'くぇ', qo: 'くぉ',
  ye: 'いぇ', wyi: 'ゐ', wye: 'ゑ',
  xa: 'ぁ', xi: 'ぃ', xu: 'ぅ', xe: 'ぇ', xo: 'ぉ',
  la: 'ぁ', li: 'ぃ', lu: 'ぅ', le: 'ぇ', lo: 'ぉ',
  xya: 'ゃ', xyu: 'ゅ', xyo: 'ょ', lya: 'ゃ', lyu: 'ゅ', lyo: 'ょ',
  xtsu: 'っ', xtu: 'っ', ltsu: 'っ', ltu: 'っ',
  xwa: 'ゎ', lwa: 'ゎ', xka: 'ゕ', xke: 'ゖ',
});

/**
 * Convert a complete romaji, hiragana, or katakana answer into hiragana.
 * This is intentionally a full-answer converter, not an incremental IME:
 * a terminal "n" is ん. Apostrophes disambiguate shin'ya from shinya.
 * Unknown characters remain visible so invalid input cannot silently pass.
 */
export function toHiragana(value) {
  const input = String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
    .replace(/[’]/g, "'")
    .replace(/-/g, 'ー');
  let result = '';
  for (let i = 0; i < input.length;) {
    const char = input[i];
    const next = input[i + 1];
    if (char === 'n') {
      if (next === "'") { result += 'ん'; i += 2; continue; }
      if (next === 'n') {
        result += 'ん';
        // "nna" -> んな; standalone "nn" and "nnk" consume both n's.
        i += /[aiueoy]/.test(input[i + 2] || '') ? 1 : 2;
        continue;
      }
      if (!next || (!/[aiueoy]/.test(next))) { result += 'ん'; i += 1; continue; }
    }
    if (/[bcdfghjkmprstvwz]/.test(char) && char === next) {
      result += 'っ'; i += 1; continue;
    }
    // Hepburn spells まっちゃ as matcha instead of maccha.
    if (char === 't' && input.slice(i + 1, i + 3) === 'ch') {
      result += 'っ'; i += 1; continue;
    }
    let matched = false;
    for (const length of [4, 3, 2, 1]) {
      const kana = ROMAJI[input.slice(i, i + length)];
      if (kana) { result += kana; i += length; matched = true; break; }
    }
    if (!matched) { result += char; i += 1; }
  }
  return result.normalize('NFC');
}

const normalizeReading = (value) => toHiragana(value).replace(/\s+/g, '').trim();
const readingText = (value) => typeof value === 'string' ? value : value?.reading || value?.text || '';
const meaningText = (value) => typeof value === 'string' ? value : value?.meaning || value?.text || '';

export function checkAnswer(item, kind, answer) {
  if (kind === 'meaning') {
    const normalized = normalizeMeaning(answer);
    if (!normalized) return { correct: false, retry: true, message: 'Type an English meaning to continue.' };
    if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(normalized)) {
      return { correct: false, retry: true, message: 'This question asks for the English meaning.' };
    }
    const accepted = [...(item.meanings || []), item.meaning].filter(Boolean).map(meaningText).map(normalizeMeaning);
    return accepted.includes(normalized)
      ? { correct: true }
      : { correct: false, message: `Meaning: ${item.meaning || meaningText(item.meanings?.[0])}` };
  }
  if (kind !== 'reading') throw new TypeError(`Unknown question kind: ${kind}`);
  const normalized = normalizeReading(answer);
  if (!normalized) return { correct: false, retry: true, message: 'Type the reading in kana or romaji.' };
  if (!/^[\p{Script=Hiragana}ー]+$/u.test(normalized)) {
    return { correct: false, retry: true, message: 'Use kana or romaji for the reading.' };
  }
  const accepted = (item.readings || []).map(readingText).map(normalizeReading);
  if (accepted.includes(normalized)) return { correct: true };
  const alternatives = (item.otherReadings || []).map(readingText).map(normalizeReading);
  if (item.type === 'kanji' && alternatives.includes(normalized)) {
    return { correct: false, retry: true, message: 'That is another reading of this kanji. Try the reading taught in this lesson.' };
  }
  return { correct: false, message: `Reading: ${(item.readings || []).map(readingText).join(' / ')}` };
}

/** Library search: matches a character, any meaning, or any reading (case-insensitive). */
export function matchesSearch(item, query = '') {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return `${item.character || ''} ${item.meaning || ''} ${(item.meanings || []).join(' ')} ${(item.readings || []).join(' ')}`.toLowerCase().includes(q);
}

/**
 * Free-practice pool. Uses the visible library list (type filter + search) when it has
 * subjects; a leftover search that matches nothing is ignored so practice never fails
 * because of a stale query. Returns at most `limit` items.
 */
export function practicePool(items, filter = 'all', query = '', limit = 10) {
  const ofType = items.filter((i) => filter === 'all' || i.type === filter);
  const matches = ofType.filter((i) => matchesSearch(i, query));
  return (matches.length ? matches : ofType.length ? ofType : items).slice(0, limit);
}

/** App views that have their own browser-history entry (#library, #guide, #settings). */
export const VIEWS = Object.freeze(['dashboard', 'library', 'guide', 'settings']);

/** Maps a location hash to a view. Supabase auth fragments and unknown hashes return null. */
export function viewFromHash(hash = '') {
  const name = String(hash || '').replace(/^#\/?/, '');
  return VIEWS.includes(name) ? name : null;
}

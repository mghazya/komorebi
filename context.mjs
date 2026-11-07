/**
 * Practice in context — on-demand grammar & sentence pack loader, session state,
 * first-attempt + follow-up scoring, and isolated completion recording.
 *
 * Pack files are loaded only when opened by the learner, never on dashboard startup.
 * Completion is stored under `profile.contextPractice[packId]` and never touches
 * `profile.progress` (SRS stages or review dates), `profile.unlockedLevel`, or `profile.history`.
 */
import { isSafeDataPath } from './curriculum.mjs?v=20261028-reading-prompts';

export const CONTEXT_PACK_1_PATH = './data/context-pack-1.json';
export const CONTEXT_PACK_2_PATH = './data/context-pack-2.json';
export const CONTEXT_PACK_3_PATH = './data/context-pack-3.json';
export const CONTEXT_PACK_4_PATH = './data/context-pack-4.json';
export const CONTEXT_PACK_5_PATH = './data/context-pack-5.json';
export const CONTEXT_PACK_6_PATH = './data/context-pack-6.json';
export const CONTEXT_PACK_7_PATH = './data/context-pack-7.json';

export const CONTEXT_PACKS = Object.freeze([
  Object.freeze({
    id: 'pack:beginner-1',
    title: 'Beginner Pack 1',
    subtitle: 'Copula, Noun Modifier & Inanimate Existence',
    label: '3 patterns · 6 questions',
    patternsSummary: 'は…です, の, に…があります',
    patternsCount: 3,
    questionsCount: 6,
    path: CONTEXT_PACK_1_PATH,
    status: 'live',
  }),
  Object.freeze({
    id: 'pack:beginner-2',
    title: 'Beginner Pack 2',
    subtitle: 'Questions, Shared Topics & Requests',
    label: '3 patterns · 6 questions',
    patternsSummary: '…ですか, も, を下さい',
    patternsCount: 3,
    questionsCount: 6,
    path: CONTEXT_PACK_2_PATH,
    status: 'live',
  }),
  Object.freeze({
    id: 'pack:beginner-3',
    title: 'Beginner Pack 3',
    subtitle: 'Living Beings, Joining Nouns & Past Facts',
    label: '3 patterns · 6 questions',
    patternsSummary: 'に…がいます, と, でした',
    patternsCount: 3,
    questionsCount: 6,
    path: CONTEXT_PACK_3_PATH,
    status: 'live',
  }),
  Object.freeze({
    id: 'pack:beginner-4',
    title: 'Beginner Pack 4',
    subtitle: 'Everyday Actions — Destination, Direct Object & Polite Verbs',
    label: '3 patterns · 6 questions',
    patternsSummary: 'に (enter), を (object), ます / ません',
    patternsCount: 3,
    questionsCount: 6,
    path: CONTEXT_PACK_4_PATH,
    status: 'live',
  }),
  Object.freeze({
    id: 'pack:beginner-5',
    title: 'Beginner Pack 5',
    subtitle: 'Actions, Accompaniment & Movement Origin',
    label: '3 patterns · 6 questions',
    patternsSummary: 'で (action), と (with), から (from)',
    patternsCount: 3,
    questionsCount: 6,
    path: CONTEXT_PACK_5_PATH,
    status: 'live',
  }),
  Object.freeze({
    id: 'pack:beginner-6',
    title: 'Beginner Pack 6',
    subtitle: 'Time Points, Movement Extent & Polite Past Actions',
    label: '3 patterns · 6 questions',
    patternsSummary: 'に (time), から…まで, ました / ませんでした',
    patternsCount: 3,
    questionsCount: 6,
    path: CONTEXT_PACK_6_PATH,
    status: 'live',
  }),
  Object.freeze({
    id: 'pack:beginner-7',
    title: 'Beginner Pack 7',
    subtitle: 'Describing Things — Adjectives, Negative Forms & Clause Contrast',
    label: '3 patterns · 6 questions',
    patternsSummary: '大きい (adjective), 〜くないです, …ですが、…',
    patternsCount: 3,
    questionsCount: 6,
    path: CONTEXT_PACK_7_PATH,
    status: 'live',
  }),
]);

export const CONTEXT_PACK_META = CONTEXT_PACKS[0];

export function getContextPackMeta(packId = CONTEXT_PACK_META.id) {
  return CONTEXT_PACKS.find((p) => p.id === packId) || null;
}

export class ContextPackError extends Error {
  constructor(message, code = 'CONTEXT_PACK_ERROR') {
    super(message);
    this.name = 'ContextPackError';
    this.code = code;
  }
}

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const deepCopy = (value) => JSON.parse(JSON.stringify(value));
const SRS_PREFIX = /^(?:radical|kanji|vocabulary):/;

function validateChoicesList(choices, correctChoice, ownerId) {
  if (!Array.isArray(choices) || choices.length < 2 || typeof correctChoice !== 'string') {
    throw new ContextPackError(`Question ${ownerId} has invalid choices.`, 'BAD_PACK');
  }
  const choiceIds = new Set();
  const choiceTexts = new Set();
  for (const c of choices) {
    if (!isPlainObject(c) || typeof c.id !== 'string' || !c.id || choiceIds.has(c.id) ||
      typeof c.text !== 'string' || !c.text.trim() ||
      typeof c.explanation !== 'string' || !c.explanation.trim()) {
      throw new ContextPackError(`Question ${ownerId} has an invalid answer choice.`, 'BAD_PACK');
    }
    const normText = c.text.trim();
    if (choiceTexts.has(normText)) {
      throw new ContextPackError(`Question ${ownerId} has duplicate choice text "${normText}".`, 'BAD_PACK');
    }
    choiceIds.add(c.id);
    choiceTexts.add(normText);
  }
  if (!choiceIds.has(correctChoice)) {
    throw new ContextPackError(`Question ${ownerId} is missing its expected choice.`, 'BAD_PACK');
  }
}

function validateWordsList(words, sentenceText, ownerId) {
  if (!Array.isArray(words) || !words.length) {
    throw new ContextPackError(`Word help for ${ownerId} must be a non-empty array.`, 'BAD_PACK');
  }
  let reconstructed = '';
  for (const w of words) {
    if (!isPlainObject(w) || typeof w.text !== 'string' || !w.text) {
      throw new ContextPackError(`Word help item in ${ownerId} has invalid text.`, 'BAD_PACK');
    }
    reconstructed += w.text;
    if (w.blank) {
      if (w.text !== '（　）' && w.text !== '(  )' && w.text !== '（ ）') {
        throw new ContextPackError(`Blank word item in ${ownerId} must represent the sentence blank.`, 'BAD_PACK');
      }
    } else if (w.punctuation) {
      // Punctuation like '。' or '、' without word help
    } else {
      if (typeof w.kana !== 'string' || !w.kana.trim() ||
        typeof w.romaji !== 'string' || !w.romaji.trim() ||
        typeof w.meaning !== 'string' || !w.meaning.trim()) {
        throw new ContextPackError(`Word "${w.text}" in ${ownerId} must specify kana, romaji, and meaning.`, 'BAD_PACK');
      }
    }
  }
  if (reconstructed !== sentenceText) {
    throw new ContextPackError(
      `Word help in ${ownerId} does not match sentence: "${reconstructed}" vs "${sentenceText}".`,
      'BAD_PACK'
    );
  }
}

export function validateContextPack(data) {
  if (!isPlainObject(data) || data.schemaVersion !== 1 || typeof data.id !== 'string' || !data.id.startsWith('pack:') ||
    typeof data.title !== 'string' || !data.title.trim() || !Array.isArray(data.patterns) || !data.patterns.length) {
    throw new ContextPackError('This practice pack is not in a supported format.', 'BAD_PACK');
  }
  const patternIds = new Set();
  const questionIds = new Set();
  const followUpIds = new Set();

  for (const pattern of data.patterns) {
    if (!isPlainObject(pattern) || typeof pattern.id !== 'string' || !pattern.id.startsWith('grammar:') ||
      SRS_PREFIX.test(pattern.id) || patternIds.has(pattern.id) ||
      typeof pattern.pattern !== 'string' || !pattern.pattern.trim() ||
      typeof pattern.gloss !== 'string' || !pattern.gloss.trim() ||
      typeof pattern.summary !== 'string' || !pattern.summary.trim() ||
      !Array.isArray(pattern.examples) || !pattern.examples.length ||
      !Array.isArray(pattern.questions) || !pattern.questions.length) {
      throw new ContextPackError('This practice pack contains an invalid grammar pattern.', 'BAD_PACK');
    }
    patternIds.add(pattern.id);

    for (const ex of pattern.examples) {
      if (!isPlainObject(ex) || typeof ex.id !== 'string' || !ex.id ||
        typeof ex.japanese !== 'string' || !ex.japanese.trim() ||
        typeof ex.english !== 'string' || !ex.english.trim()) {
        throw new ContextPackError(`Pattern ${pattern.id} has an invalid example.`, 'BAD_PACK');
      }
    }

    for (const q of pattern.questions) {
      if (!isPlainObject(q) || typeof q.id !== 'string' || !q.id.startsWith('question:') ||
        SRS_PREFIX.test(q.id) || questionIds.has(q.id) ||
        typeof q.prompt !== 'string' || !q.prompt.trim() ||
        typeof q.japanese !== 'string' || !q.japanese.trim()) {
        throw new ContextPackError(`Pattern ${pattern.id} has an invalid question.`, 'BAD_PACK');
      }
      questionIds.add(q.id);
      validateChoicesList(q.choices, q.correctChoice, q.id);
      if (q.words !== undefined) {
        validateWordsList(q.words, q.japanese, q.id);
      }

      const fu = q.followUp;
      if (!isPlainObject(fu) || typeof fu.id !== 'string' || !fu.id.startsWith('followup:') ||
        SRS_PREFIX.test(fu.id) || followUpIds.has(fu.id) ||
        typeof fu.prompt !== 'string' || !fu.prompt.trim() ||
        typeof fu.japanese !== 'string' || !fu.japanese.trim() ||
        fu.japanese.trim() === q.japanese.trim()) {
        throw new ContextPackError(`Question ${q.id} is missing a valid fresh follow-up question.`, 'BAD_PACK');
      }
      followUpIds.add(fu.id);
      validateChoicesList(fu.choices, fu.correctChoice, fu.id);
      if (fu.words !== undefined) {
        validateWordsList(fu.words, fu.japanese, fu.id);
      }

      const we = fu.workedExample;
      if (!isPlainObject(we) || typeof we.japanese !== 'string' || !we.japanese.trim() ||
        typeof we.english !== 'string' || !we.english.trim() ||
        typeof we.breakdown !== 'string' || !we.breakdown.trim()) {
        throw new ContextPackError(`Follow-up ${fu.id} is missing a valid worked example.`, 'BAD_PACK');
      }
    }
  }

  return deepCopy(data);
}

export async function loadContextPack({
  fetch = globalThis.fetch?.bind(globalThis),
  packId = null,
  path = null,
} = {}) {
  const resolvedPath = path || (packId ? getContextPackMeta(packId)?.path : CONTEXT_PACK_1_PATH);
  if (!resolvedPath || !isSafeDataPath(resolvedPath)) {
    throw new ContextPackError('Invalid practice pack path.', 'BAD_PATH');
  }
  if (typeof fetch !== 'function') {
    throw new ContextPackError('Practice pack could not be loaded right now.', 'NETWORK');
  }
  let response;
  try {
    response = await fetch(resolvedPath, { cache: 'no-cache' });
  } catch {
    throw new ContextPackError('Practice pack could not be loaded. Check your connection and try again.', 'NETWORK');
  }
  if (!response || !response.ok) {
    throw new ContextPackError('Practice pack could not be loaded right now. Your lessons and reviews are still ready.', 'NETWORK');
  }
  let raw;
  try {
    raw = await response.json();
  } catch {
    throw new ContextPackError('Practice pack data could not be read.', 'BAD_PACK');
  }
  return validateContextPack(raw);
}

export function createContextSession(pack) {
  const validated = validateContextPack(pack);
  const questions = [];
  validated.patterns.forEach((pattern, pIdx) => {
    pattern.questions.forEach((q, qIdx) => {
      questions.push({
        ...q,
        patternId: pattern.id,
        patternIndex: pIdx,
        patternQuestionIndex: qIdx,
      });
    });
  });

  return {
    mode: 'context',
    phase: 'quiz',
    pack: validated,
    questions,
    position: 0,
    inFollowUp: false,
    showReading: false,
    activeWordHelp: null,
    selectedChoice: null,
    triedChoices: {},
    feedback: null,
    firstAttempts: {},
    awaitingFollowUp: {},
    followUpResults: {},
    resolved: {},
    startedAt: Date.now(),
  };
}

/**
 * Evaluates a learner's selected choice in Practice in context:
 * - On the original question (`!session.inFollowUp`):
 *   - First attempt is permanently recorded in `firstAttempts[q.id]`.
 *   - If right: marks `resolved[q.id] = true` so the learner can advance.
 *   - If wrong: explains the specific misunderstanding, marks `awaitingFollowUp[q.id] = true`,
 *     and locks the original question so the missed sentence is not immediately repeated.
 * - On the follow-up question (`session.inFollowUp === true`):
 *   - Records the follow-up outcome separately in `followUpResults[q.id]`.
 *   - If right: explains why the follow-up choice works and marks `resolved[q.id] = true`.
 *   - If wrong: explains why the follow-up choice doesn't work, attaches the prewritten
 *     `workedExample`, and marks `resolved[q.id] = true` so the learner can continue.
 */
export function selectContextChoice(session, choiceId) {
  if (!session || session.mode !== 'context' || session.phase !== 'quiz') return session;
  const q = session.questions?.[session.position];
  if (!q) return session;
  if (session.resolved?.[q.id]) return session;

  if (!session.inFollowUp) {
    if (session.awaitingFollowUp?.[q.id]) return session;
    const choice = q.choices.find((c) => c.id === choiceId);
    if (!choice) return session;

    const isCorrect = choice.id === q.correctChoice;
    const firstAttempts = { ...(session.firstAttempts || {}), [q.id]: isCorrect };
    const triedChoices = { ...(session.triedChoices || {}), [q.id]: [choice.id] };
    const resolved = { ...(session.resolved || {}) };
    const awaitingFollowUp = { ...(session.awaitingFollowUp || {}) };

    if (isCorrect) {
      resolved[q.id] = true;
    } else {
      awaitingFollowUp[q.id] = true;
    }

    return {
      ...session,
      selectedChoice: choice.id,
      triedChoices,
      firstAttempts,
      awaitingFollowUp,
      resolved,
      feedback: {
        stage: 'primary',
        questionId: q.id,
        choiceId: choice.id,
        text: choice.text,
        lang: choice.lang || 'en',
        correct: isCorrect,
        explanation: choice.explanation,
        workedExample: null,
      },
    };
  }

  // Follow-up stage for a missed original question
  const fu = q.followUp;
  if (!fu) return session;
  const choice = fu.choices.find((c) => c.id === choiceId);
  if (!choice) return session;

  const isCorrect = choice.id === fu.correctChoice;
  const triedChoices = { ...(session.triedChoices || {}), [fu.id]: [choice.id] };
  const followUpResults = {
    ...(session.followUpResults || {}),
    [q.id]: {
      questionId: q.id,
      followUpId: fu.id,
      choiceId: choice.id,
      correct: isCorrect,
      workedExampleShown: !isCorrect,
    },
  };
  const resolved = { ...(session.resolved || {}), [q.id]: true };

  return {
    ...session,
    selectedChoice: choice.id,
    triedChoices,
    followUpResults,
    resolved,
    feedback: {
      stage: 'followup',
      questionId: q.id,
      followUpId: fu.id,
      choiceId: choice.id,
      text: choice.text,
      lang: choice.lang || 'en',
      correct: isCorrect,
      explanation: choice.explanation,
      workedExample: isCorrect ? null : deepCopy(fu.workedExample),
    },
  };
}

/**
 * Transitions from a missed original question's misunderstanding explanation
 * to its fresh, prewritten follow-up question testing the same grammar point.
 */
export function startContextFollowUp(session) {
  if (!session || session.mode !== 'context' || session.phase !== 'quiz') return session;
  const q = session.questions?.[session.position];
  if (!q || session.inFollowUp || !session.awaitingFollowUp?.[q.id] || session.resolved?.[q.id]) {
    return session;
  }
  return {
    ...session,
    inFollowUp: true,
    showReading: false,
    activeWordHelp: null,
    selectedChoice: null,
    feedback: null,
  };
}

/**
 * Sets or toggles the active word help index.
 * Calling with the currently active index or null toggles it off.
 * This is an optional, unscored assistance feature that never alters
 * score, answers, or kanji review schedules.
 */
export function setContextWordHelp(session, wordIndexOrNull) {
  if (!session || session.mode !== 'context' || session.phase !== 'quiz') return session;
  const current = session.activeWordHelp;
  const next = (wordIndexOrNull === null || wordIndexOrNull === undefined || current === wordIndexOrNull)
    ? null
    : wordIndexOrNull;
  return {
    ...session,
    activeWordHelp: next,
  };
}

export function scoreContextSession(session) {
  const questions = session?.questions || [];
  const total = questions.length;
  const correct = questions.filter((q) => session?.firstAttempts?.[q.id] === true).length;
  const resolvedCount = questions.filter((q) => session?.resolved?.[q.id] === true).length;
  const complete = total > 0 && resolvedCount === total;
  const missedQuestions = questions
    .filter((q) => session?.firstAttempts?.[q.id] === false)
    .map((q) => q.id);
  const followUpItems = {};
  let followUpAttempted = 0;
  let followUpCorrect = 0;
  let workedExamplesShown = 0;
  for (const q of questions) {
    const res = session?.followUpResults?.[q.id];
    if (res) {
      followUpAttempted += 1;
      if (res.correct) followUpCorrect += 1;
      if (res.workedExampleShown) workedExamplesShown += 1;
      followUpItems[q.id] = {
        followUpId: res.followUpId,
        choiceId: res.choiceId,
        correct: Boolean(res.correct),
        workedExampleShown: Boolean(res.workedExampleShown),
      };
    }
  }
  return {
    correct,
    total,
    resolvedCount,
    complete,
    missedQuestions,
    followUp: {
      attempted: followUpAttempted,
      correct: followUpCorrect,
      workedExamplesShown,
      items: followUpItems,
    },
  };
}

/**
 * Saves completion under `profile.contextPractice[pack.id]` for the active learner only.
 * Records both the first-attempt score (`lastScore`, `missedQuestions`) and the separate
 * follow-up outcomes (`followUp`). Refuses to mark an unfinished pack complete, and never
 * modifies `profile.progress`, `profile.unlockedLevel`, or `profile.history`.
 */
export function recordContextCompletion(profile, pack, score, now = Date.now()) {
  if (!isPlainObject(profile) || !isPlainObject(pack) || typeof pack.id !== 'string') {
    throw new ContextPackError('Cannot record completion without a valid learner profile and pack.', 'INVALID_ARGS');
  }
  if (!isPlainObject(score) || !score.complete || !Number.isInteger(score.correct) || !Number.isInteger(score.total) ||
    score.total <= 0 || score.correct < 0 || score.correct > score.total) {
    throw new ContextPackError('An unfinished practice pack cannot be marked complete.', 'INCOMPLETE_PACK');
  }
  const next = deepCopy(profile);
  if (!isPlainObject(next.contextPractice)) {
    next.contextPractice = {};
  }
  const prev = isPlainObject(next.contextPractice[pack.id]) ? next.contextPractice[pack.id] : null;
  const prevBest = Number.isInteger(prev?.bestScore?.correct) ? prev.bestScore.correct : -1;
  const bestCorrect = Math.max(prevBest, score.correct);
  const prevAttempts = Number.isInteger(prev?.attempts) && prev.attempts >= 0 ? prev.attempts : 0;

  const missedQuestions = Array.isArray(score.missedQuestions)
    ? score.missedQuestions.filter((id) => typeof id === 'string' && id)
    : [];
  const rawFollowUp = isPlainObject(score.followUp) ? score.followUp : null;
  const followUp = rawFollowUp
    ? {
        attempted: Number.isInteger(rawFollowUp.attempted) && rawFollowUp.attempted >= 0 ? rawFollowUp.attempted : missedQuestions.length,
        correct: Number.isInteger(rawFollowUp.correct) && rawFollowUp.correct >= 0 ? rawFollowUp.correct : 0,
        workedExamplesShown: Number.isInteger(rawFollowUp.workedExamplesShown) && rawFollowUp.workedExamplesShown >= 0 ? rawFollowUp.workedExamplesShown : 0,
        items: isPlainObject(rawFollowUp.items) ? deepCopy(rawFollowUp.items) : {},
      }
    : {
        attempted: 0,
        correct: 0,
        workedExamplesShown: 0,
        items: {},
      };

  next.contextPractice[pack.id] = {
    completedAt: now,
    patterns: Array.isArray(pack.patterns) ? pack.patterns.map((p) => p.id) : [],
    lastScore: { correct: score.correct, total: score.total },
    bestScore: { correct: bestCorrect, total: score.total },
    missedQuestions,
    followUp,
    attempts: prevAttempts + 1,
  };
  return next;
}

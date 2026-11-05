/**
 * Practice in context — on-demand grammar & sentence pack loader, session state,
 * first-attempt scoring, and isolated completion recording.
 *
 * Pack files are loaded only when opened by the learner, never on dashboard startup.
 * Completion is stored under `profile.contextPractice[packId]` and never touches
 * `profile.progress` (SRS stages or review dates), `profile.unlockedLevel`, or `profile.history`.
 */
import { isSafeDataPath } from './curriculum.mjs?v=20261028-reading-prompts';

export const CONTEXT_PACK_1_PATH = './data/context-pack-1.json';
export const CONTEXT_PACK_META = Object.freeze({
  id: 'pack:beginner-1',
  title: 'Beginner Pack 1',
  label: '3 patterns · 6 questions',
  patternsCount: 3,
  questionsCount: 6,
  path: CONTEXT_PACK_1_PATH,
});

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

export function validateContextPack(data) {
  if (!isPlainObject(data) || data.schemaVersion !== 1 || typeof data.id !== 'string' || !data.id.startsWith('pack:') ||
    typeof data.title !== 'string' || !data.title.trim() || !Array.isArray(data.patterns) || !data.patterns.length) {
    throw new ContextPackError('This practice pack is not in a supported format.', 'BAD_PACK');
  }
  const patternIds = new Set();
  const questionIds = new Set();

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
        typeof q.japanese !== 'string' || !q.japanese.trim() ||
        typeof q.correctChoice !== 'string' ||
        !Array.isArray(q.choices) || q.choices.length < 2) {
        throw new ContextPackError(`Pattern ${pattern.id} has an invalid question.`, 'BAD_PACK');
      }
      questionIds.add(q.id);
      const choiceIds = new Set();
      for (const c of q.choices) {
        if (!isPlainObject(c) || typeof c.id !== 'string' || !c.id || choiceIds.has(c.id) ||
          typeof c.text !== 'string' || !c.text.trim() ||
          typeof c.explanation !== 'string' || !c.explanation.trim()) {
          throw new ContextPackError(`Question ${q.id} has an invalid answer choice.`, 'BAD_PACK');
        }
        choiceIds.add(c.id);
      }
      if (!choiceIds.has(q.correctChoice)) {
        throw new ContextPackError(`Question ${q.id} is missing its expected choice.`, 'BAD_PACK');
      }
    }
  }

  return deepCopy(data);
}

export async function loadContextPack({ fetch = globalThis.fetch?.bind(globalThis), path = CONTEXT_PACK_1_PATH } = {}) {
  if (!isSafeDataPath(path)) {
    throw new ContextPackError('Invalid practice pack path.', 'BAD_PATH');
  }
  if (typeof fetch !== 'function') {
    throw new ContextPackError('Practice pack could not be loaded right now.', 'NETWORK');
  }
  let response;
  try {
    response = await fetch(path, { cache: 'no-cache' });
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
    showReading: false,
    selectedChoice: null,
    triedChoices: {},
    feedback: null,
    firstAttempts: {},
    resolved: {},
    startedAt: Date.now(),
  };
}

/**
 * Evaluates a learner's selected choice on the current question.
 * - First attempt on each question is permanently recorded in `firstAttempts[q.id]`.
 * - Retrying a question updates `selectedChoice` and `feedback` (explaining the chosen option)
 *   without overwriting `firstAttempts[q.id]`.
 * - A question is marked `resolved[q.id] = true` only when its correct choice is selected.
 */
export function selectContextChoice(session, choiceId) {
  if (!session || session.mode !== 'context' || session.phase !== 'quiz') return session;
  const q = session.questions?.[session.position];
  if (!q) return session;
  if (session.resolved?.[q.id]) return session;
  const choice = q.choices.find((c) => c.id === choiceId);
  if (!choice) return session;

  const isCorrect = choice.id === q.correctChoice;
  const firstAttempts = { ...(session.firstAttempts || {}) };
  if (!(q.id in firstAttempts)) {
    firstAttempts[q.id] = isCorrect;
  }

  const prevTried = Array.isArray(session.triedChoices?.[q.id]) ? session.triedChoices[q.id] : [];
  const triedForQ = prevTried.includes(choice.id) ? prevTried : [...prevTried, choice.id];
  const triedChoices = { ...(session.triedChoices || {}), [q.id]: triedForQ };

  const resolved = { ...(session.resolved || {}) };
  if (isCorrect) {
    resolved[q.id] = true;
  }

  return {
    ...session,
    selectedChoice: choice.id,
    triedChoices,
    firstAttempts,
    resolved,
    feedback: {
      questionId: q.id,
      choiceId: choice.id,
      text: choice.text,
      lang: choice.lang || 'en',
      correct: isCorrect,
      explanation: choice.explanation,
    },
  };
}

export function scoreContextSession(session) {
  const questions = session?.questions || [];
  const total = questions.length;
  const correct = questions.filter((q) => session?.firstAttempts?.[q.id] === true).length;
  const resolvedCount = questions.filter((q) => session?.resolved?.[q.id] === true).length;
  const complete = total > 0 && resolvedCount === total;
  return { correct, total, resolvedCount, complete };
}

/**
 * Saves completion under `profile.contextPractice[pack.id]` for the active learner only.
 * Refuses to mark an unfinished pack complete, and never modifies `profile.progress`,
 * `profile.unlockedLevel`, or `profile.history`.
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

  next.contextPractice[pack.id] = {
    completedAt: now,
    patterns: Array.isArray(pack.patterns) ? pack.patterns.map((p) => p.id) : [],
    lastScore: { correct: score.correct, total: score.total },
    bestScore: { correct: bestCorrect, total: score.total },
    attempts: prevAttempts + 1,
  };
  return next;
}

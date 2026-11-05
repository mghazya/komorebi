import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  CONTEXT_PACK_1_PATH,
  CONTEXT_PACK_2_PATH,
  CONTEXT_PACK_3_PATH,
  CONTEXT_PACK_4_PATH,
  CONTEXT_PACKS,
  CONTEXT_PACK_META,
  getContextPackMeta,
  ContextPackError,
  validateContextPack,
  loadContextPack,
  createContextSession,
  selectContextChoice,
  startContextFollowUp,
  scoreContextSession,
  recordContextCompletion,
} from '../context.mjs';
import { runMechanicalChecks } from '../scripts/validate-context-packs.mjs';
import {
  validateProfile,
  serializeBackup,
  parseBackupDocument,
  readBackupFile,
} from '../profile.mjs';
import { createCloudSync } from '../sync.mjs';
import { newProfile } from '../engine.mjs';

const packRaw = JSON.parse(fs.readFileSync(new URL('../data/context-pack-1.json', import.meta.url), 'utf8'));
const level1Raw = JSON.parse(fs.readFileSync(new URL('../data/level-1.json', import.meta.url), 'utf8'));
const appSource = fs.readFileSync(new URL('../app.mjs', import.meta.url), 'utf8');

test('Beginner Pack 1 structure, varied answer positions, Q3/Q6 edits, follow-ups, worked examples, and Level 1 subject links', () => {
  const pack = validateContextPack(packRaw);
  assert.equal(pack.id, 'pack:beginner-1');
  assert.equal(pack.label, '3 patterns · 6 questions');
  assert.equal(pack.patterns.length, 3);

  const level1Ids = new Set(level1Raw.map((item) => item.id));
  for (const pattern of pack.patterns) {
    assert.equal(pattern.examples.length, 2, `${pattern.id} should have 2 examples`);
    assert.equal(pattern.questions.length, 2, `${pattern.id} should have 2 questions`);
    assert.equal(pattern.questions.filter((q) => q.isFreshSentence).length, 1, `${pattern.id} must have 1 fresh unseen sentence`);
    for (const subjId of pattern.subjectIds) {
      assert.ok(level1Ids.has(subjId), `Subject ${subjId} in ${pattern.id} must exist in data/level-1.json`);
    }
    for (const q of pattern.questions) {
      assert.ok(q.followUp, `${q.id} must include a prewritten followUp question`);
      assert.notEqual(q.followUp.japanese, q.japanese, `${q.id} followUp must be a fresh sentence, not a repeat`);
      assert.ok(q.followUp.workedExample?.japanese, `${q.id} followUp must include a workedExample`);
      assert.ok(q.followUp.workedExample?.breakdown, `${q.id} followUp workedExample must include a breakdown`);
    }
  }

  const session = createContextSession(pack);
  assert.equal(session.questions.length, 6);
  assert.deepEqual(
    session.questions.map((q) => q.correctChoice),
    ['B', 'C', 'A', 'C', 'B', 'A'],
    'Correct answer positions must be varied (2 A, 2 B, 2 C)'
  );
  assert.deepEqual(
    session.questions.map((q) => q.followUp.correctChoice),
    ['A', 'B', 'C', 'B', 'C', 'A'],
    'Follow-up correct answer positions must also be varied (2 A, 2 B, 2 C)'
  );

  // Verify Q3 edit: ここは駅（　）入り口です。 with choices の, は, を
  const q3 = session.questions[2];
  assert.equal(q3.id, 'question:no-modifier-1');
  assert.equal(q3.japanese, 'ここは駅（　）入り口です。');
  assert.equal(q3.correctChoice, 'A');
  assert.deepEqual(q3.choices.map((c) => c.text), ['の', 'は', 'を']);

  // Verify Q6 edit: テーブルの上にりんごが三つあります。 with choices A/B/C
  const q6 = session.questions[5];
  assert.equal(q6.id, 'question:ni-ga-arimasu-2');
  assert.equal(q6.japanese, 'テーブルの上にりんごが三つあります。');
  assert.equal(q6.correctChoice, 'A');
  assert.equal(q6.choices[0].text, 'There are three apples on the table.');
  assert.equal(q6.choices[1].text, 'There are three people at the table.');
  assert.equal(q6.choices[2].text, 'There are three apples under the table.');
});

test('Pack loads on demand only when opened, and a failed pack download leaves lessons/reviews usable', async () => {
  let packFetches = 0;
  const loaded = await loadContextPack({
    path: CONTEXT_PACK_1_PATH,
    fetch: async (url) => {
      packFetches += 1;
      assert.equal(url, './data/context-pack-1.json');
      return { ok: true, json: async () => packRaw };
    },
  });
  assert.equal(packFetches, 1);
  assert.equal(loaded.id, CONTEXT_PACK_META.id);

  // Startup in app.mjs only calls loadCurriculum() and loadImages(), never loadContextPack()
  const startupSlice = appSource.slice(appSource.lastIndexOf('curriculum=await loadCurriculum()'));
  assert.doesNotMatch(startupSlice, /loadContextPack/, 'Startup must not fetch context pack');

  // Failed pack download throws ContextPackError cleanly
  await assert.rejects(
    () => loadContextPack({ fetch: async () => ({ ok: false, status: 503 }) }),
    (err) => err instanceof ContextPackError && err.code === 'NETWORK'
  );
});

test('Wrong-answer flow: explains misunderstanding, locks missed sentence against immediate repeat, shows fresh follow-up, and shows worked example on follow-up miss', () => {
  const s0 = createContextSession(packRaw);
  const level1Map = new Map(level1Raw.map((i) => [i.id, i]));
  const c = vm.createContext({
    session: s0,
    getItem: (id) => level1Map.get(id),
    scoreContextSession,
    esc: (v) => String(v ?? ''),
    icon: () => '',
    glyph: (i) => i.character || '',
  });
  const renderCode = appSource.slice(
    appSource.indexOf('function renderContextSession('),
    appSource.indexOf('function leaveSession(')
  );
  vm.runInContext(renderCode, c);

  // 1. Question 1 rendered alone, reading hidden by default
  const html1 = vm.runInContext('renderContextSession(session)', c);
  assert.match(html1, /QUESTION 1 OF 6/);
  assert.doesNotMatch(html1, /QUESTION 2 OF 6/);
  assert.match(html1, /Show reading/);
  assert.doesNotMatch(html1, /ふじさんは おおきい やま です。/);

  // 2. Toggle Show reading on
  c.session = { ...s0, showReading: true };
  const htmlReading = vm.runInContext('renderContextSession(session)', c);
  assert.match(htmlReading, /Hide reading/);
  assert.match(htmlReading, /ふじさんは おおきい やま です。/);

  // 3. Select wrong choice A on Q1:
  //    - Explains why Choice A doesn't work
  //    - Records Q1 as a first-attempt miss
  //    - Disables repeating Q1 ("B" on Q1 is ignored while awaiting follow-up)
  //    - Offers "Try follow-up question" instead of repeating the missed sentence
  const sWrong = selectContextChoice(c.session, 'A');
  assert.equal(sWrong.firstAttempts['question:wa-desu-1'], false);
  assert.equal(sWrong.awaitingFollowUp['question:wa-desu-1'], true);
  assert.equal(Boolean(sWrong.resolved['question:wa-desu-1']), false);

  const sAttemptRepeat = selectContextChoice(sWrong, 'B');
  assert.equal(sAttemptRepeat, sWrong, 'Must not allow immediately repeating the missed sentence');

  c.session = sWrong;
  const htmlWrong = vm.runInContext('renderContextSession(session)', c);
  assert.match(htmlWrong, /Why Choice A doesn’t work/);
  assert.match(htmlWrong, /大きい \(おおきい\) means “big,” not “above”/);
  assert.match(htmlWrong, /data-action="start-context-followup"/);
  assert.match(htmlWrong, /Try follow-up question/);
  assert.doesNotMatch(htmlWrong, /data-action="next-context-question"/);

  // 4. Transition to fresh follow-up question for Q1 (same grammar point は…です, fresh sentence あの女の人は大人です。)
  const sFollowUp = startContextFollowUp(sWrong);
  assert.equal(sFollowUp.inFollowUp, true);
  c.session = sFollowUp;
  const htmlFollowUp = vm.runInContext('renderContextSession(session)', c);
  assert.match(htmlFollowUp, /FOLLOW-UP FOR QUESTION 1 · SAME GRAMMAR POINT/);
  assert.match(htmlFollowUp, /あの女の人は大人です。/);
  assert.doesNotMatch(htmlFollowUp, /<p class="context-sentence-jp" lang="ja">ふじ山は大きい山です。<\/p>/);

  // 5. Answer Q1 follow-up correctly ('A'):
  //    - Original remains recorded as a first-attempt miss (false)
  //    - Follow-up is recorded separately as understood (true, workedExampleShown: false)
  //    - Question step is resolved so learner can continue to Q2
  const sFollowUpRight = selectContextChoice(sFollowUp, 'A');
  assert.equal(sFollowUpRight.firstAttempts['question:wa-desu-1'], false);
  assert.deepEqual(sFollowUpRight.followUpResults['question:wa-desu-1'], {
    questionId: 'question:wa-desu-1',
    followUpId: 'followup:wa-desu-1',
    choiceId: 'A',
    correct: true,
    workedExampleShown: false,
  });
  assert.equal(sFollowUpRight.resolved['question:wa-desu-1'], true);
  c.session = sFollowUpRight;
  const htmlFollowUpRight = vm.runInContext('renderContextSession(session)', c);
  assert.match(htmlFollowUpRight, /Choice A is correct/);
  assert.doesNotMatch(htmlFollowUpRight, /WORKED EXAMPLE/);
  assert.match(htmlFollowUpRight, /data-action="next-context-question"/);

  // 6. Now test missing BOTH the original question AND the follow-up on Q2:
  //    - Shows a worked example and lets the learner continue
  let sQ2 = { ...sFollowUpRight, position: 1, inFollowUp: false, showReading: false, selectedChoice: null, feedback: null };
  sQ2 = selectContextChoice(sQ2, 'A'); // miss Q2 original (correct is 'C')
  assert.equal(sQ2.firstAttempts['question:wa-desu-2'], false);
  sQ2 = startContextFollowUp(sQ2);
  assert.equal(sQ2.inFollowUp, true);

  // Miss Q2 follow-up too (choose 'A' instead of 'B')
  const sQ2FollowUpWrong = selectContextChoice(sQ2, 'A');
  assert.equal(sQ2FollowUpWrong.firstAttempts['question:wa-desu-2'], false);
  assert.deepEqual(sQ2FollowUpWrong.followUpResults['question:wa-desu-2'], {
    questionId: 'question:wa-desu-2',
    followUpId: 'followup:wa-desu-2',
    choiceId: 'A',
    correct: false,
    workedExampleShown: true,
  });
  assert.equal(sQ2FollowUpWrong.resolved['question:wa-desu-2'], true, 'Learner can continue after reviewing worked example');
  assert.ok(sQ2FollowUpWrong.feedback.workedExample);

  c.session = sQ2FollowUpWrong;
  const htmlWorked = vm.runInContext('renderContextSession(session)', c);
  assert.match(htmlWorked, /Why Choice A doesn’t work/);
  assert.match(htmlWorked, /WORKED EXAMPLE/);
  assert.match(htmlWorked, /あの山はふじ山です。/);
  assert.match(htmlWorked, /Step 1: Identify who or what the sentence is about/);
  assert.match(htmlWorked, /data-action="next-context-question"/);
});

test('Separate first-attempt and follow-up scoring + unfinished pack guard', () => {
  let s = createContextSession(packRaw);

  // Q1: miss original ('A'), start follow-up, answer follow-up right ('A')
  s = selectContextChoice(s, 'A');
  assert.equal(scoreContextSession(s).complete, false, 'Awaiting follow-up is not resolved');
  s = startContextFollowUp(s);
  s = selectContextChoice(s, 'A');
  assert.equal(s.firstAttempts['question:wa-desu-1'], false);
  assert.equal(s.followUpResults['question:wa-desu-1'].correct, true);
  assert.equal(s.resolved['question:wa-desu-1'], true);

  // Unfinished after 1 question: score.complete is false and recordContextCompletion refuses
  const partialScore = scoreContextSession(s);
  assert.equal(partialScore.complete, false);
  assert.equal(partialScore.resolvedCount, 1);
  const learner = newProfile('Learner 1', 'learner-1');
  assert.throws(
    () => recordContextCompletion(learner, s.pack, partialScore),
    (err) => err instanceof ContextPackError && err.code === 'INCOMPLETE_PACK'
  );

  // Q2: right on 1st try ('C')
  s = { ...s, position: 1, inFollowUp: false, selectedChoice: null, feedback: null };
  s = selectContextChoice(s, 'C');

  // Q3: miss original ('B'), start follow-up, miss follow-up too ('A' instead of 'C') -> worked example shown
  s = { ...s, position: 2, inFollowUp: false, selectedChoice: null, feedback: null };
  s = selectContextChoice(s, 'B');
  s = startContextFollowUp(s);
  s = selectContextChoice(s, 'A');
  assert.equal(s.followUpResults['question:no-modifier-1'].correct, false);
  assert.equal(s.followUpResults['question:no-modifier-1'].workedExampleShown, true);
  assert.equal(s.resolved['question:no-modifier-1'], true);

  // Q4..Q6: right on 1st try ('C', 'B', 'A')
  for (const [pos, pick] of [[3, 'C'], [4, 'B'], [5, 'A']]) {
    s = { ...s, position: pos, inFollowUp: false, selectedChoice: null, feedback: null };
    s = selectContextChoice(s, pick);
  }

  const finalScore = scoreContextSession(s);
  assert.equal(finalScore.complete, true);
  assert.equal(finalScore.total, 6);
  assert.equal(finalScore.correct, 4, '4 of 6 answered right on the first attempt');
  assert.deepEqual(finalScore.missedQuestions, ['question:wa-desu-1', 'question:no-modifier-1']);
  assert.deepEqual(finalScore.followUp, {
    attempted: 2,
    correct: 1,
    workedExamplesShown: 1,
    items: {
      'question:wa-desu-1': {
        followUpId: 'followup:wa-desu-1',
        choiceId: 'A',
        correct: true,
        workedExampleShown: false,
      },
      'question:no-modifier-1': {
        followUpId: 'followup:no-modifier-1',
        choiceId: 'A',
        correct: false,
        workedExampleShown: true,
      },
    },
  });
});

test('Completing, missing, or leaving a question never changes existing kanji stages or review dates', () => {
  const baseProfile = {
    id: 'learner-srs',
    name: 'SRS Learner',
    createdAt: 1762300000000,
    unlockedLevel: 2,
    progress: {
      'radical:mountain': { stage: 6, availableAt: 1763500000000, passedAt: 1762310000000 },
      'kanji:山': { stage: 5, availableAt: 1762900000000, passedAt: 1762320000000 },
      'vocabulary:入り口': { stage: 3, availableAt: 1762360000000 },
      'vocabulary:ふじ山': { stage: 1, availableAt: 1762339200000 },
    },
    history: [{ type: 'review', id: 'kanji:山', at: 1762320000000 }],
    settings: { batchSize: 5 },
  };
  const snapshotProgress = JSON.stringify(baseProfile.progress);
  const snapshotHistory = JSON.stringify(baseProfile.history);

  // 1. Leaving mid-pack after missing and answering follow-up does not touch profile at all
  let midSession = createContextSession(packRaw);
  midSession = selectContextChoice(midSession, 'C'); // miss Q1
  midSession = startContextFollowUp(midSession);
  midSession = selectContextChoice(midSession, 'A'); // resolve Q1 via follow-up
  midSession = { ...midSession, position: 1, inFollowUp: false };
  midSession = selectContextChoice(midSession, 'A'); // miss Q2 and leave
  assert.equal(scoreContextSession(midSession).complete, false);
  assert.equal(JSON.stringify(baseProfile.progress), snapshotProgress);

  // 2. Completing the pack with misses & follow-ups updates only contextPractice
  let fullSession = createContextSession(packRaw);
  // Q1: miss original ('A'), get follow-up right ('A')
  fullSession = selectContextChoice(fullSession, 'A');
  fullSession = startContextFollowUp(fullSession);
  fullSession = selectContextChoice(fullSession, 'A');
  // Q2: right ('C')
  fullSession = { ...fullSession, position: 1, inFollowUp: false, selectedChoice: null, feedback: null };
  fullSession = selectContextChoice(fullSession, 'C');
  // Q3: right ('A')
  fullSession = { ...fullSession, position: 2, inFollowUp: false, selectedChoice: null, feedback: null };
  fullSession = selectContextChoice(fullSession, 'A');
  // Q4: miss original ('A'), miss follow-up ('A') -> worked example
  fullSession = { ...fullSession, position: 3, inFollowUp: false, selectedChoice: null, feedback: null };
  fullSession = selectContextChoice(fullSession, 'A');
  fullSession = startContextFollowUp(fullSession);
  fullSession = selectContextChoice(fullSession, 'A');
  // Q5: right ('B')
  fullSession = { ...fullSession, position: 4, inFollowUp: false, selectedChoice: null, feedback: null };
  fullSession = selectContextChoice(fullSession, 'B');
  // Q6: right ('A')
  fullSession = { ...fullSession, position: 5, inFollowUp: false, selectedChoice: null, feedback: null };
  fullSession = selectContextChoice(fullSession, 'A');

  const score = scoreContextSession(fullSession);
  assert.equal(score.correct, 4);
  assert.equal(score.total, 6);
  assert.equal(score.complete, true);
  assert.equal(score.followUp.attempted, 2);
  assert.equal(score.followUp.correct, 1);
  assert.equal(score.followUp.workedExamplesShown, 1);

  const after = recordContextCompletion(baseProfile, fullSession.pack, score, 1762335000000);
  assert.equal(JSON.stringify(after.progress), snapshotProgress, 'SRS stages and availableAt dates must be untouched');
  assert.equal(JSON.stringify(after.history), snapshotHistory, 'SRS history must be untouched');
  assert.equal(after.unlockedLevel, 2, 'unlockedLevel must be untouched');
  assert.deepEqual(after.contextPractice['pack:beginner-1'], {
    completedAt: 1762335000000,
    patterns: ['grammar:wa-desu', 'grammar:no-modifier', 'grammar:ni-ga-arimasu'],
    lastScore: { correct: 4, total: 6 },
    bestScore: { correct: 4, total: 6 },
    missedQuestions: ['question:wa-desu-1', 'question:no-modifier-2'],
    followUp: {
      attempted: 2,
      correct: 1,
      workedExamplesShown: 1,
      items: {
        'question:wa-desu-1': {
          followUpId: 'followup:wa-desu-1',
          choiceId: 'A',
          correct: true,
          workedExampleShown: false,
        },
        'question:no-modifier-2': {
          followUpId: 'followup:no-modifier-2',
          choiceId: 'A',
          correct: false,
          workedExampleShown: true,
        },
      },
    },
    attempts: 1,
  });
});

test('Storage verification: guest reload, backup round-trip, two-session sync, and two-account isolation', async () => {
  const pack = validateContextPack(packRaw);

  // 1. Guest reload & multi-guest isolation in localStorage
  const guest1 = {
    ...newProfile('Guest 1', 'guest-1'),
    progress: { 'kanji:山': { stage: 4, availableAt: 1762400000000 } },
  };
  const guest2 = {
    ...newProfile('Guest 2', 'guest-2'),
    progress: { 'kanji:川': { stage: 2, availableAt: 1762380000000 } },
  };
  const sampleScore = {
    correct: 5,
    total: 6,
    resolvedCount: 6,
    complete: true,
    missedQuestions: ['question:wa-desu-1'],
    followUp: {
      attempted: 1,
      correct: 1,
      workedExamplesShown: 0,
      items: {
        'question:wa-desu-1': {
          followUpId: 'followup:wa-desu-1',
          choiceId: 'A',
          correct: true,
          workedExampleShown: false,
        },
      },
    },
  };
  const guest1Completed = recordContextCompletion(guest1, pack, sampleScore, 1762336000000);
  const savedStore = JSON.stringify({
    version: 1,
    activeProfileId: guest1Completed.id,
    profiles: [guest1Completed, guest2],
  });

  // Simulate reload through readState's validateProfile map
  const reloadedData = JSON.parse(savedStore);
  reloadedData.profiles = reloadedData.profiles.map(validateProfile);
  assert.deepEqual(reloadedData.profiles[0].contextPractice['pack:beginner-1'].lastScore, { correct: 5, total: 6 });
  assert.deepEqual(reloadedData.profiles[0].contextPractice['pack:beginner-1'].followUp.correct, 1);
  assert.deepEqual(reloadedData.profiles[0].progress, guest1.progress);
  assert.equal(reloadedData.profiles[1].contextPractice, undefined, 'Guest 2 must remain isolated');

  // 2. Backup round-trip (serializeBackup -> parseBackupDocument & readBackupFile)
  const backupText = serializeBackup(reloadedData.profiles[0], { exportedAt: '2026-11-05T09:00:00.000Z' });
  const parsedFromDoc = parseBackupDocument(JSON.parse(backupText));
  assert.deepEqual(parsedFromDoc, reloadedData.profiles[0]);
  const parsedFromFile = await readBackupFile({
    size: Buffer.byteLength(backupText, 'utf8'),
    text: async () => backupText,
  });
  assert.deepEqual(parsedFromFile, reloadedData.profiles[0]);

  // 3. Sync across two sessions for the same account + 4. Isolation between two disposable accounts
  const remoteRows = new Map();
  let activeSessionUser = { id: 'acct-disposable-a', email: 'a@example.com' };

  const makeMockCloud = (getSessionFn) => ({
    getSession: getSessionFn,
    async loadProfile() {
      const s = getSessionFn();
      if (!s) throw new Error('Not signed in');
      const row = remoteRows.get(s.user.id);
      return row ? JSON.parse(JSON.stringify(row)) : null;
    },
    async saveProfile(profile, expectedRevision) {
      const s = getSessionFn();
      if (!s) throw new Error('Not signed in');
      const current = remoteRows.get(s.user.id);
      const currentRev = current ? current.revision : 0;
      assert.equal(expectedRevision, currentRev, 'Expected revision must match remote revision');
      const nextRow = {
        profile: JSON.parse(JSON.stringify({ ...profile, id: s.user.id })),
        revision: currentRev + 1,
      };
      remoteRows.set(s.user.id, nextRow);
      return JSON.parse(JSON.stringify(nextRow));
    },
  });

  remoteRows.set('acct-disposable-a', {
    revision: 1,
    profile: {
      id: 'acct-disposable-a',
      name: 'Account A',
      createdAt: 1762300000000,
      progress: { 'kanji:入': { stage: 5, availableAt: 1762900000000, passedAt: 1762300000000 } },
    },
  });

  const storage1 = new Map();
  const storage2 = new Map();
  const mockStore = (m) => ({
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  });

  const syncSession1 = createCloudSync({
    cloud: makeMockCloud(() => (activeSessionUser ? { user: activeSessionUser } : null)),
    storage: mockStore(storage1),
    validate: validateProfile,
    emptyProfile: (u) => newProfile(u.email, u.id),
  });
  const syncSession2 = createCloudSync({
    cloud: makeMockCloud(() => ({ user: { id: 'acct-disposable-a', email: 'a@example.com' } })),
    storage: mockStore(storage2),
    validate: validateProfile,
    emptyProfile: (u) => newProfile(u.email, u.id),
  });

  await syncSession1.connect();
  await syncSession2.connect();

  const acctAUpdated = recordContextCompletion(syncSession1.state.profile, pack, sampleScore, 1762337000000);
  assert.equal(await syncSession1.update(acctAUpdated), true);

  await syncSession2.reload();
  assert.deepEqual(syncSession2.state.profile.contextPractice['pack:beginner-1'].lastScore, { correct: 5, total: 6 });
  assert.deepEqual(syncSession2.state.profile.contextPractice['pack:beginner-1'].followUp.correct, 1);

  activeSessionUser = null;
  syncSession1.reset(null);
  activeSessionUser = { id: 'acct-disposable-b', email: 'b@example.com' };
  await syncSession1.connect();
  assert.equal(syncSession1.state.profile.contextPractice, undefined, 'Account B must not inherit Account A completion');
});

test('End-to-end app.mjs flow: miss original -> explain -> follow-up understood, miss follow-up -> worked example, and completion breakdown', async () => {
  let activeProfile = {
    ...newProfile('Active Learner', 'learner-active'),
    progress: {
      'kanji:山': { stage: 5, availableAt: 1762900000000, passedAt: 1762300000000 },
      'vocabulary:入り口': { stage: 2, availableAt: 1762350000000 },
    },
  };
  let inactiveProfile = {
    ...newProfile('Other Learner', 'learner-other'),
    progress: { 'kanji:川': { stage: 3, availableAt: 1762360000000 } },
  };
  const srsSnapshot = JSON.stringify(activeProfile.progress);
  const toasts = [];
  const level1Map = new Map(level1Raw.map((i) => [i.id, i]));

  const c = vm.createContext({
    session: null,
    busy: false,
    view: 'dashboard',
    filter: 'radical',
    dashboardLevel: 1,
    items: level1Raw,
    curriculum: { availableLevels: [1], loadedLevels: [1], failedLevels: [] },
    sync: { state: { profile: null, error: '' } },
    CONTEXT_PACK_META,
    loadContextPack: async () => validateContextPack(packRaw),
    createContextSession,
    selectContextChoice,
    startContextFollowUp,
    scoreContextSession,
    recordContextCompletion,
    profile: () => activeProfile,
    currentLevel: () => 1,
    levelProgress: () => ({ radicalTotal: 25, radicalPassed: 0, kanjiTotal: 18, kanjiPassed: 1, vocabularyTotal: 37, vocabularyPassed: 0, required: 17 }),
    nextLevelAfter: () => null,
    dailyLessonTargetOf: () => 15,
    lessonsStartedToday: () => 0,
    batchSizeOf: () => 5,
    loadReviewSession: () => null,
    timeUntil: () => 'in 2h',
    TYPES: { radical: 'Radicals', kanji: 'Kanji', vocabulary: 'Vocabulary' },
    tile: () => '',
    upcoming: () => '',
    daysStudiedCard: () => '',
    getItem: (id) => level1Map.get(id),
    glyph: (i) => i.character || '',
    esc: (v) => String(v ?? ''),
    icon: () => '',
    toast: (msg) => toasts.push(msg),
    setBusy: (v) => { c.busy = v; },
    leaveSession: () => true,
    history: { state: {} },
    historyCall: () => {},
    urlForView: () => '/',
    window: { scrollTo: () => {} },
    requestAnimationFrame: (fn) => fn(),
    $: () => ({ focus: () => {} }),
    render: () => {},
    updateProfile: async (next) => {
      if (next.id === activeProfile.id) activeProfile = validateProfile(next);
      return true;
    },
    Date,
  });

  const dashboardCode = appSource.slice(appSource.indexOf('function dashboard('), appSource.indexOf('function daysStudiedCard('));
  const contextHandlersCode = appSource.slice(appSource.indexOf('async function beginContextPractice('), appSource.indexOf('function leaveSession('));
  vm.runInContext(`${dashboardCode}\n${contextHandlersCode}`, c);

  // 1. Open pack -> starts at Question 1
  await vm.runInContext('beginContextPractice()', c);
  assert.equal(c.session.position, 0);

  // 2. Q1: miss original ('A'), cannot advance until follow-up is completed
  vm.runInContext('chooseContextAnswer("A")', c);
  await vm.runInContext('nextContextQuestion()', c);
  assert.equal(c.session.position, 0, 'Cannot skip follow-up after missing original question');
  vm.runInContext('beginContextFollowUp()', c);
  assert.equal(c.session.inFollowUp, true);
  vm.runInContext('chooseContextAnswer("A")', c); // Q1 follow-up correct ('A')
  await vm.runInContext('nextContextQuestion()', c);
  assert.equal(c.session.position, 1);
  assert.equal(c.session.inFollowUp, false);

  // 3. Q2: miss original ('A'), then miss follow-up ('A' instead of 'B') -> shows worked example and lets learner continue
  vm.runInContext('chooseContextAnswer("A")', c);
  vm.runInContext('beginContextFollowUp()', c);
  vm.runInContext('chooseContextAnswer("A")', c);
  assert.ok(c.session.feedback.workedExample, 'Worked example shown when follow-up is missed');
  await vm.runInContext('nextContextQuestion()', c);
  assert.equal(c.session.position, 2);

  // 4. Q3..Q6: right on first attempt ('A', 'C', 'B', 'A')
  for (const [idx, pick] of [[2, 'A'], [3, 'C'], [4, 'B'], [5, 'A']]) {
    assert.equal(c.session.position, idx);
    vm.runInContext(`chooseContextAnswer("${pick}")`, c);
    await vm.runInContext('nextContextQuestion()', c);
  }

  // 5. Pack is done, completion screen shows both first-attempt score (4/6) and follow-up outcome (1/2)
  assert.equal(c.session.phase, 'done');
  const doneHtml = vm.runInContext('renderContextSession(session)', c);
  assert.match(doneHtml, /4\/6/);
  assert.match(doneHtml, /1\/2/);
  assert.match(doneHtml, /First try: Missed/);
  assert.match(doneHtml, /Follow-up: Understood/);
  assert.match(doneHtml, /Follow-up: Missed · Worked example reviewed/);

  assert.deepEqual(activeProfile.contextPractice['pack:beginner-1'].lastScore, { correct: 4, total: 6 });
  assert.equal(activeProfile.contextPractice['pack:beginner-1'].followUp.attempted, 2);
  assert.equal(activeProfile.contextPractice['pack:beginner-1'].followUp.correct, 1);
  assert.equal(activeProfile.contextPractice['pack:beginner-1'].followUp.workedExamplesShown, 1);
  assert.equal(JSON.stringify(activeProfile.progress), srsSnapshot);
  assert.equal(inactiveProfile.contextPractice, undefined);

  // 6. Dashboard badge shows both first-try and follow-up summary
  const dashHtmlAfter = vm.runInContext('dashboard({ lessons: 5, reviews: 2, learned: 1, nextReviewAt: 1762350000000 })', c);
  assert.match(dashHtmlAfter, /Completed · 4\/6 first try · 1\/2 follow-up/);
});

test('Automated mechanical checks: coverage checklist, resumable skip, Packs 2-4 structure, on-demand loading, and multi-pack completion isolation', async () => {
  // 1. Run mechanical validator twice to verify idempotency and resumable skip of approved packs
  const checkRun1 = runMechanicalChecks();
  const checkRun2 = runMechanicalChecks();
  assert.equal(checkRun1.ok, true);
  assert.deepEqual(checkRun1, checkRun2, 'Rerunning mechanical checks must be idempotent and resume from checklist');
  assert.deepEqual(checkRun1.skippedApprovedPacks, [
    'pack:beginner-1',
    'pack:beginner-2',
    'pack:beginner-3',
    'pack:beginner-4',
  ]);
  assert.equal(checkRun1.totalChecklistEntries, 147);
  assert.equal(checkRun1.taughtMeaningsCount, 16);
  assert.ok(checkRun1.flaggedMeaningsCount >= 8, 'Ambiguous/overlapping or deferred items must be flagged');

  // 2. Verify each of the three new packs (Pack 2, Pack 3, Pack 4) loads on demand by packId
  const packPathsById = {
    'pack:beginner-1': CONTEXT_PACK_1_PATH,
    'pack:beginner-2': CONTEXT_PACK_2_PATH,
    'pack:beginner-3': CONTEXT_PACK_3_PATH,
    'pack:beginner-4': CONTEXT_PACK_4_PATH,
  };
  let learner = {
    ...newProfile('Multi-Pack Learner', 'learner-multipack'),
    progress: {
      'kanji:山': { stage: 5, availableAt: 1762900000000, passedAt: 1762300000000 },
      'vocabulary:入る': { stage: 3, availableAt: 1762360000000 },
    },
  };
  const srsBefore = JSON.stringify(learner.progress);

  for (const meta of CONTEXT_PACKS.slice(1)) {
    assert.equal(getContextPackMeta(meta.id)?.path, packPathsById[meta.id]);
    const raw = JSON.parse(fs.readFileSync(new URL(`.${meta.path}`, import.meta.url), 'utf8'));
    let fetchedUrl = null;
    const loadedPack = await loadContextPack({
      packId: meta.id,
      fetch: async (url) => {
        fetchedUrl = url;
        return { ok: true, json: async () => raw };
      },
    });
    assert.equal(fetchedUrl, meta.path, `${meta.id} must load on demand from ${meta.path}`);

    let sess = createContextSession(loadedPack);
    assert.equal(sess.questions.length, 6);

    // Miss Q1 on first attempt, then get Q1 follow-up right; answer Q2..Q6 right on first attempt
    const q1Wrong = sess.questions[0].choices.find((c) => c.id !== sess.questions[0].correctChoice).id;
    sess = selectContextChoice(sess, q1Wrong);
    sess = startContextFollowUp(sess);
    sess = selectContextChoice(sess, sess.questions[0].followUp.correctChoice);

    for (let i = 1; i < sess.questions.length; i++) {
      sess = { ...sess, position: i, inFollowUp: false, selectedChoice: null, feedback: null };
      sess = selectContextChoice(sess, sess.questions[i].correctChoice);
    }

    const score = scoreContextSession(sess);
    assert.equal(score.complete, true);
    assert.equal(score.correct, 5);
    assert.equal(score.followUp.attempted, 1);
    assert.equal(score.followUp.correct, 1);

    learner = recordContextCompletion(learner, loadedPack, score, 1762340000000);
  }

  // Verify all 3 new packs saved their separate first-attempt and follow-up scores without touching SRS
  assert.equal(JSON.stringify(learner.progress), srsBefore, 'Completing Packs 2-4 must never alter kanji/vocab stages or review dates');
  for (const pid of ['pack:beginner-2', 'pack:beginner-3', 'pack:beginner-4']) {
    assert.deepEqual(learner.contextPractice[pid].lastScore, { correct: 5, total: 6 });
    assert.equal(learner.contextPractice[pid].followUp.attempted, 1);
    assert.equal(learner.contextPractice[pid].followUp.correct, 1);
  }
  const validatedLearner = validateProfile(learner);
  assert.deepEqual(validatedLearner, learner);
});

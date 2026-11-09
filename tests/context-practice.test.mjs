import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {
  CONTEXT_PACK_1_PATH,
  CONTEXT_PACK_2_PATH,
  CONTEXT_PACK_3_PATH,
  CONTEXT_PACK_4_PATH,
  CONTEXT_PACK_5_PATH,
  CONTEXT_PACK_6_PATH,
  CONTEXT_PACK_7_PATH,
  CONTEXT_PACK_8_PATH,
  CONTEXT_PACK_9_PATH,
  CONTEXT_PACK_10_PATH,
  CONTEXT_PACKS,
  CONTEXT_PACK_META,
  getContextPackMeta,
  ContextPackError,
  validateContextPack,
  loadContextPack,
  createContextSession,
  selectContextChoice,
  startContextFollowUp,
  setContextWordHelp,
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
    'pack:beginner-5',
    'pack:beginner-6',
    'pack:beginner-7',
    'pack:beginner-8',
    'pack:beginner-9',
    'pack:beginner-10',
  ]);
  assert.equal(checkRun1.totalChecklistEntries, 147);
  assert.equal(checkRun1.taughtMeaningsCount, 35);
  assert.ok(checkRun1.flaggedMeaningsCount >= 8, 'Ambiguous/overlapping or deferred items must be flagged');

  // 2. Verify each of the new packs (Packs 2-10) loads on demand by packId
  const packPathsById = {
    'pack:beginner-1': CONTEXT_PACK_1_PATH,
    'pack:beginner-2': CONTEXT_PACK_2_PATH,
    'pack:beginner-3': CONTEXT_PACK_3_PATH,
    'pack:beginner-4': CONTEXT_PACK_4_PATH,
    'pack:beginner-5': CONTEXT_PACK_5_PATH,
    'pack:beginner-6': CONTEXT_PACK_6_PATH,
    'pack:beginner-7': CONTEXT_PACK_7_PATH,
    'pack:beginner-8': CONTEXT_PACK_8_PATH,
    'pack:beginner-9': CONTEXT_PACK_9_PATH,
    'pack:beginner-10': CONTEXT_PACK_10_PATH,
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

  // Verify all new packs saved their separate first-attempt and follow-up scores without touching SRS
  assert.equal(JSON.stringify(learner.progress), srsBefore, 'Completing Packs 2-7 must never alter kanji/vocab stages or review dates');
  for (const pid of [
    'pack:beginner-2',
    'pack:beginner-3',
    'pack:beginner-4',
    'pack:beginner-5',
    'pack:beginner-6',
    'pack:beginner-7',
  ]) {
    assert.deepEqual(learner.contextPractice[pid].lastScore, { correct: 5, total: 6 });
    assert.equal(learner.contextPractice[pid].followUp.attempted, 1);
    assert.equal(learner.contextPractice[pid].followUp.correct, 1);
  }
  const validatedLearner = validateProfile(learner);
  assert.deepEqual(validatedLearner, learner);
});

test('Tap-to-read word help: interactive words, cloze blank hiding, contextual readings, and answer isolation', async () => {
  const pack1 = await loadContextPack({
    fetch: async () => ({
      ok: true,
      json: async () => JSON.parse(fs.readFileSync(CONTEXT_PACK_1_PATH, 'utf8')),
    }),
  });

  // 1. Session initialization includes activeWordHelp: null
  let session = createContextSession(pack1);
  assert.equal(session.activeWordHelp, null);

  // 2. Q1 words are defined and match sentence exactly
  const q1 = session.questions[0];
  assert.ok(Array.isArray(q1.words) && q1.words.length > 0);
  const q1Reconstructed = q1.words.map((w) => w.text).join('');
  assert.equal(q1Reconstructed, q1.japanese);

  // Contextual particles: は has kana 'わ' and romaji 'wa'
  const waWord = q1.words.find((w) => w.text === 'は');
  assert.ok(waWord);
  assert.equal(waWord.kana, 'わ');
  assert.equal(waWord.romaji, 'wa');
  assert.equal(waWord.meaning, 'topic marker');

  // 3. Toggling word help with setContextWordHelp
  session = setContextWordHelp(session, 0); // activate word 0: ふじ山
  assert.equal(session.activeWordHelp, 0);

  // Calling again with the same index toggles off (null)
  session = setContextWordHelp(session, 0);
  assert.equal(session.activeWordHelp, null);

  // Setting another word
  session = setContextWordHelp(session, 2); // 大きい
  assert.equal(session.activeWordHelp, 2);

  // 4. Word help does not alter answer choice selection or scores
  assert.equal(session.selectedChoice, null);
  session = selectContextChoice(session, 'B'); // Choose correct answer B
  assert.equal(session.selectedChoice, 'B');
  assert.equal(session.firstAttempts[q1.id], true);
  // Word help is preserved when an answer is selected (does not clear)
  assert.equal(session.activeWordHelp, 2);

  // Toggling word help after an answer has been selected does not clear or change the chosen answer
  session = setContextWordHelp(session, 1);
  assert.equal(session.activeWordHelp, 1);
  assert.equal(session.selectedChoice, 'B');
  assert.equal(session.firstAttempts[q1.id], true);

  // 5. App rendering test for word buttons and word help tray
  const appCode = fs.readFileSync(new URL('../app.mjs', import.meta.url), 'utf8');
  const c = vm.createContext({
    window: { scrollTo: () => {}, location: { pathname: '/', search: '', hash: '' } },
    document: {
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ setAttribute: () => {}, appendChild: () => {} }),
      body: { appendChild: () => {} },
    },
    history: { state: null, pushState: () => {}, replaceState: () => {} },
    session,
    profile: () => ({ id: 'learner-1', name: 'Learner', progress: {}, contextPractice: {} }),
    getItem: () => null,
    glyph: () => '',
  });

  const renderSnippet = `
    const esc = ${c.esc ? 'esc' : "value => String(value ?? '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]))"};
    const icon = () => '';
    ${appCode.slice(appCode.indexOf('function renderContextSession('), appCode.indexOf('function leaveSession('))}
  `;
  vm.runInContext(renderSnippet, c);

  // Render when word 1 (は) is active
  const htmlWordActive = vm.runInContext('renderContextSession(session)', c);
  assert.match(htmlWordActive, /class="context-word-btn is-active"[^>]*data-word-index="1"/);
  assert.match(htmlWordActive, /aria-expanded="true"/);
  assert.match(htmlWordActive, /aria-controls="context-word-help-tray"/);
  assert.match(htmlWordActive, /class="context-word-help-tray has-word"/);
  assert.match(htmlWordActive, /class="context-word-help-kana"[^>]*>わ<\/span>/);
  assert.match(htmlWordActive, /class="context-word-help-romaji">wa<\/span>/);
  assert.match(htmlWordActive, /class="context-word-help-meaning">topic marker<\/span>/);
  assert.match(htmlWordActive, /data-action="close-context-word-help"/);

  // Render when word help is closed (idle)
  session = setContextWordHelp(session, null);
  c.session = session;
  const htmlIdle = vm.runInContext('renderContextSession(session)', c);
  assert.match(htmlIdle, /class="context-word-help-tray is-idle"/);
  assert.match(htmlIdle, /Tap or click a word for reading &amp; meaning/);
  assert.doesNotMatch(htmlIdle, /class="context-word-help-tray has-word"/);

  // 6. Q3 Cloze blank hiding and compound word:
  //    ここは駅（　）入り口です。
  const q3 = session.questions[2];
  assert.ok(q3.words);
  const blankWord = q3.words.find((w) => w.blank);
  assert.ok(blankWord, 'Cloze question must include a blank word item');
  assert.equal(blankWord.text, '（　）');
  assert.equal(blankWord.kana, undefined);
  assert.equal(blankWord.meaning, undefined);

  // Compound word: 入り口 is treated as one word
  const entranceWord = q3.words.find((w) => w.text === '入り口');
  assert.ok(entranceWord, '入り口 must be a single entry');
  assert.equal(entranceWord.kana, 'いりぐち');
  assert.equal(entranceWord.romaji, 'iriguchi');
  assert.equal(entranceWord.meaning, 'entrance');

  // Render Q3 to check blank rendering
  session = { ...session, position: 2, inFollowUp: false, selectedChoice: null, feedback: null, activeWordHelp: null };
  c.session = session;
  const htmlQ3 = vm.runInContext('renderContextSession(session)', c);
  assert.match(htmlQ3, /<span class="context-word-blank" aria-label="blank">（　）<\/span>/);
  // Ensure the blank is NOT wrapped in a word button
  assert.doesNotMatch(htmlQ3, /<button[^>]*class="context-word-btn"[^>]*>（　）<\/button>/);
  // Ensure 入り口 is rendered as one button
  assert.match(htmlQ3, /<button type="button" class="context-word-btn "[^>]*>入り口<\/button>/);

  // 7. Validation rejects malformed word definitions
  assert.throws(
    () => validateContextPack({
      ...pack1,
      patterns: [{
        ...pack1.patterns[0],
        questions: [{
          ...pack1.patterns[0].questions[0],
          words: [{ text: 'wrong', kana: 'w', romaji: 'w', meaning: 'm' }], // mismatch
        }],
      }],
    }),
    /does not match sentence/
  );

  // 8. Verify across all 10 packs that every primary and follow-up question includes validated word help
  for (let packNum = 1; packNum <= 10; packNum++) {
    const raw = JSON.parse(fs.readFileSync(`data/context-pack-${packNum}.json`, 'utf8'));
    const validated = validateContextPack(raw);
    for (const pat of validated.patterns) {
      for (const q of pat.questions) {
        for (const item of [q, q.followUp]) {
          assert.ok(Array.isArray(item.words) && item.words.length > 0, `Missing words in ${item.id}`);
          if (Array.isArray(item.dialogue)) {
            assert.equal(
              item.words.map((w) => w.text).join(''),
              item.dialogue.map((t) => t.japanese).join(''),
              `Dialogue word mismatch in ${item.id}`
            );
          } else {
            assert.equal(item.words.map((w) => w.text).join(''), item.japanese, `Mismatch in ${item.id}`);
          }
          for (const w of item.words) {
            if (w.blank) {
              assert.equal(w.kana, undefined, `Blank in ${item.id} must not leak kana`);
              assert.equal(w.meaning, undefined, `Blank in ${item.id} must not leak meaning`);
            } else if (!w.punctuation) {
              assert.ok(w.text && w.kana && w.romaji && w.meaning, `Missing fields in ${item.id} word ${w.text}`);
            }
          }
        }
      }
    }
  }
});

test('Release readiness: fresh asset version tags, 360px / 200% zoom styling, cloze secrecy, and scoring invariance', async () => {
  // 1. Fresh asset version tags
  const indexHtml = fs.readFileSync('index.html', 'utf8');
  assert.match(indexHtml, /href="\.\/style\.css\?v=20261109-packs-8-10"/, 'index.html must have fresh style.css version tag');
  assert.match(indexHtml, /src="\.\/app\.mjs\?v=20261109-packs-8-10"/, 'index.html must have fresh app.mjs version tag');

  const appCode = fs.readFileSync('app.mjs', 'utf8');
  assert.match(appCode, /profile\.mjs\?v=20261109-packs-8-10/, 'app.mjs must have fresh profile.mjs version tag');
  assert.match(appCode, /context\.mjs\?v=20261109-packs-8-10/, 'app.mjs must have fresh context.mjs version tag');

  // 2. CSS supports long word-help cards at 360px viewport and 200% text size
  const css = fs.readFileSync('style.css', 'utf8');
  assert.match(css, /\.context-word-help-main[\s\S]*?overflow-wrap:\s*anywhere;/, 'context-word-help-main must support overflow-wrap: anywhere');
  assert.match(css, /\.context-word-help-main[\s\S]*?word-break:\s*break-word;/, 'context-word-help-main must support word-break: break-word');
  assert.match(css, /\.context-word-help-card[\s\S]*?align-items:\s*flex-start;/, 'context-word-help-card must align top to keep close button stable');
  assert.match(css, /@media\s*\(max-width:\s*380px\)/, 'style.css must have dedicated 360-380px narrow phone media query');

  // 3. Render longest word card (下げませんでした in Pack 6 Q6)
  const pack6 = await loadContextPack({
    fetch: async () => ({
      ok: true,
      json: async () => JSON.parse(fs.readFileSync(CONTEXT_PACK_6_PATH, 'utf8')),
    }),
  });
  let session6 = createContextSession(pack6);
  // Find question:mashita-past-2
  const qIdx = session6.questions.findIndex((q) => q.id === 'question:mashita-past-2');
  assert.ok(qIdx >= 0);
  session6 = { ...session6, position: qIdx };
  // Find word index for 下げませんでした
  const wordIdx = session6.questions[qIdx].words.findIndex((w) => w.text === '下げませんでした');
  assert.ok(wordIdx >= 0);
  session6 = setContextWordHelp(session6, wordIdx);

  const c = vm.createContext({
    window: { scrollTo: () => {}, location: { pathname: '/', search: '', hash: '' } },
    document: {
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ setAttribute: () => {}, appendChild: () => {} }),
      body: { appendChild: () => {} },
    },
    history: { state: null, pushState: () => {}, replaceState: () => {} },
    session: session6,
    profile: () => ({ id: 'learner-1', name: 'Learner', progress: {}, contextPractice: {} }),
    getItem: () => null,
    glyph: () => '',
  });

  const renderSnippet = `
    const esc = value => String(value ?? '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]));
    const icon = () => '';
    ${appCode.slice(appCode.indexOf('function renderContextSession('), appCode.indexOf('function leaveSession('))}
  `;
  vm.runInContext(renderSnippet, c);
  const htmlLongCard = vm.runInContext('renderContextSession(session)', c);
  assert.match(htmlLongCard, /下げませんでした/);
  assert.match(htmlLongCard, /さげませんでした/);
  assert.match(htmlLongCard, /sagemasen deshita/);
  assert.match(htmlLongCard, /did not lower/);
  assert.match(htmlLongCard, /data-action="close-context-word-help"/);

  // 4. Hidden cloze answers across all fill-in-the-blank questions
  for (let pNum = 1; pNum <= 10; pNum++) {
    const raw = JSON.parse(fs.readFileSync(`data/context-pack-${pNum}.json`, 'utf8'));
    for (const pat of raw.patterns) {
      for (const q of pat.questions) {
        for (const item of [q, q.followUp]) {
          if (item.kind === 'cloze') {
            assert.ok(item.japanese.includes('（　）') || item.japanese.includes('(  )'), `${item.id} cloze must contain blank indicator`);
            const blankW = item.words.find((w) => w.blank);
            assert.ok(blankW, `${item.id} must define a blank word object`);
            assert.equal(blankW.kana, undefined);
            assert.equal(blankW.romaji, undefined);
            assert.equal(blankW.meaning, undefined);
          }
        }
      }
    }
  }

  // 5. Unchanged scoring & isolation when toggling word help
  let sScoring = createContextSession(pack6);
  const initialAttempts = JSON.stringify(sScoring.firstAttempts);
  sScoring = setContextWordHelp(sScoring, 0);
  sScoring = setContextWordHelp(sScoring, 1);
  sScoring = setContextWordHelp(sScoring, null);
  assert.equal(JSON.stringify(sScoring.firstAttempts), initialAttempts, 'Word help lookup must never change firstAttempts');
  assert.equal(sScoring.selectedChoice, null, 'Word help lookup must never select a choice');

  const beforeScore = scoreContextSession(sScoring);
  sScoring = setContextWordHelp(sScoring, 2);
  const afterScore = scoreContextSession(sScoring);
  assert.deepEqual(beforeScore, afterScore, 'Word help lookup must never alter session score');
});

test('Validator enforces all structural and mechanical checks on live/approved packs (approval status never skips structural validation)', () => {
  // 1. All 10 packs are unconditionally reported as structurally validated
  const result = runMechanicalChecks();
  assert.equal(result.ok, true);
  assert.deepEqual(result.structurallyValidatedPacks, [
    'pack:beginner-1',
    'pack:beginner-2',
    'pack:beginner-3',
    'pack:beginner-4',
    'pack:beginner-5',
    'pack:beginner-6',
    'pack:beginner-7',
    'pack:beginner-8',
    'pack:beginner-9',
    'pack:beginner-10',
  ]);
  assert.deepEqual(result.skippedFromRegeneration, [
    'pack:beginner-1',
    'pack:beginner-2',
    'pack:beginner-3',
    'pack:beginner-4',
    'pack:beginner-5',
    'pack:beginner-6',
    'pack:beginner-7',
    'pack:beginner-8',
    'pack:beginner-9',
    'pack:beginner-10',
  ]);

  // Helper to run checks in an isolated temporary root directory with a modified pack
  const runWithModifiedPack = (packFileName, modifierFn) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validator-regression-'));
    try {
      fs.cpSync('data', path.join(tmpDir, 'data'), { recursive: true });
      fs.copyFileSync('app.mjs', path.join(tmpDir, 'app.mjs'));

      const packFilePath = path.join(tmpDir, 'data', packFileName);
      const raw = JSON.parse(fs.readFileSync(packFilePath, 'utf8'));
      modifierFn(raw);
      fs.writeFileSync(packFilePath, JSON.stringify(raw, null, 2));

      runMechanicalChecks({ rootDir: tmpDir });
      assert.fail(`Expected runMechanicalChecks to throw on corrupted ${packFileName}`);
    } catch (err) {
      if (err.name === 'AssertionError') throw err;
      return err.message;
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  };

  // 2. Regression Check A: Live pack:beginner-1 missing follow-up throws
  const errA = runWithModifiedPack('context-pack-1.json', (pack) => {
    delete pack.patterns[0].questions[0].followUp;
  });
  assert.match(errA, /missing a valid fresh follow-up question/, 'Live pack with missing follow-up must fail validation');

  // 3. Regression Check B: Live pack:beginner-5 with broken choice explanation throws
  const errB = runWithModifiedPack('context-pack-5.json', (pack) => {
    const correctC = pack.patterns[0].questions[0].choices.find(
      (c) => c.id === pack.patterns[0].questions[0].correctChoice
    );
    correctC.explanation = 'Random invalid feedback text without affirmation';
  });
  assert.match(errB, /must affirm why it works/, 'Live pack with non-affirming correct choice feedback must fail validation');

  // 4. Regression Check C: Live pack:beginner-7 with broken key variety throws
  const errC = runWithModifiedPack('context-pack-7.json', (pack) => {
    // Replace any correctChoice C with B (and affirm B, distractor C) so position C is never used
    for (const pat of pack.patterns) {
      for (const q of pat.questions) {
        for (const item of [q, q.followUp]) {
          if (item && item.correctChoice === 'C') {
            item.correctChoice = 'B';
            const bChoice = item.choices.find((c) => c.id === 'B');
            if (bChoice) bChoice.explanation = 'That’s right! Choice B is correct.';
            const cChoice = item.choices.find((c) => c.id === 'C');
            if (cChoice) cChoice.explanation = 'Not quite. Choice C is incorrect.';
          }
        }
      }
    }
  });
  assert.match(errC, /do not use choice position C/, 'Live pack with unvaried answer keys must fail validation');
});

test('SRS Progress Invariance: Populated Radicals, Kanji, and Vocabulary across stages 1-9 remain untouched during context practice', () => {
  const NOW = 1762300000000;
  const populatedProgress = {
    'radical:barb': { stage: 1, availableAt: NOW - 3600000 * 3 },
    'radical:big': { stage: 5, availableAt: NOW + 3600000 * 48, passedAt: NOW - 3600000 * 72 },
    'radical:construction': { stage: 9, availableAt: 0, burnedAt: NOW - 86400000 * 90 },
    'kanji:上': { stage: 2, availableAt: NOW + 3600000 * 8 },
    'kanji:下': { stage: 4, availableAt: NOW - 60000 },
    'kanji:大': { stage: 7, availableAt: NOW + 86400000 * 14, passedAt: NOW - 86400000 * 30 },
    'vocabulary:上': { stage: 3, availableAt: NOW + 3600000 * 24 },
    'vocabulary:大人': { stage: 6, availableAt: NOW + 86400000 * 7, passedAt: NOW - 86400000 * 21 },
    'vocabulary:一人': { stage: 8, availableAt: NOW + 86400000 * 30, passedAt: NOW - 86400000 * 60 },
  };

  const initialSnapshot = JSON.stringify(populatedProgress);

  const learner = {
    ...newProfile('Populated Invariance Learner', 'learner-populated-test'),
    progress: JSON.parse(initialSnapshot),
    history: [
      { type: 'review', id: 'radical:big', at: NOW - 3600000 * 72 },
      { type: 'review', id: 'kanji:大', at: NOW - 86400000 * 30 },
    ],
  };

  // Perform context practice on Pack 1 with incorrect answer, follow-up, and word lookups
  const pack1Raw = JSON.parse(fs.readFileSync('data/context-pack-1.json', 'utf8'));
  const pack1 = validateContextPack(pack1Raw);
  let session = createContextSession(pack1);

  // Word lookup
  session = setContextWordHelp(session, 0);
  session = setContextWordHelp(session, 1);
  session = setContextWordHelp(session, null);

  // Wrong choice on Q1
  session = selectContextChoice(session, 'A'); // Choice A is distractor for Q1
  assert.equal(session.feedback.correct, false);
  assert.equal(session.awaitingFollowUp[session.questions[0].id], true);

  // Word lookup while answer selected
  session = setContextWordHelp(session, 2);
  assert.equal(session.selectedChoice, 'A', 'Word lookup must preserve selected choice');

  // Follow-up
  session = startContextFollowUp(session);
  assert.equal(session.inFollowUp, true);
  session = setContextWordHelp(session, 0);
  session = selectContextChoice(session, 'A'); // Choice A is correct for follow-up
  assert.equal(session.feedback.correct, true);

  // Answer remaining 5 questions
  for (let i = 1; i < 6; i++) {
    session.position = i;
    session.inFollowUp = false;
    const q = session.questions[i];
    session = selectContextChoice(session, q.correctChoice);
  }

  const score = scoreContextSession(session);
  assert.equal(score.complete, true);
  assert.equal(score.correct, 5); // 5/6 first-try correct
  assert.equal(score.followUp.attempted, 1);
  assert.equal(score.followUp.correct, 1);

  // Record completion into learner profile
  const updatedLearner = recordContextCompletion(learner, session.pack, score);

  // Assertions:
  // 1. Context completion is recorded
  assert.ok(updatedLearner.contextPractice['pack:beginner-1']);
  assert.equal(updatedLearner.contextPractice['pack:beginner-1'].lastScore.correct, 5);
  assert.equal(updatedLearner.contextPractice['pack:beginner-1'].lastScore.total, 6);
  assert.equal(updatedLearner.contextPractice['pack:beginner-1'].followUp.correct, 1);

  // 2. SRS progress is 100% invariant across all 9 populated items and review dates
  assert.equal(
    JSON.stringify(updatedLearner.progress),
    initialSnapshot,
    'Learner SRS progress must remain byte-for-byte identical after context practice completion'
  );
  assert.deepEqual(updatedLearner.progress, populatedProgress);
});

test('Explicit dialogue formatting in Packs 8-10: separate A/B speaker turns, word-help indexing across turns, cloze secrecy, and ordinary sentences unchanged', () => {
  const pack8Raw = JSON.parse(fs.readFileSync('data/context-pack-8.json', 'utf8'));
  const pack9Raw = JSON.parse(fs.readFileSync('data/context-pack-9.json', 'utf8'));
  const pack10Raw = JSON.parse(fs.readFileSync('data/context-pack-10.json', 'utf8'));

  const pack8 = validateContextPack(pack8Raw);
  const pack9 = validateContextPack(pack9Raw);
  const pack10 = validateContextPack(pack10Raw);

  // 1. Pack 8: all 6 questions and all 6 follow-ups are explicit 2-turn A/B dialogues
  for (const pat of pack8.patterns) {
    for (const q of pat.questions) {
      for (const item of [q, q.followUp]) {
        assert.ok(Array.isArray(item.dialogue), `${item.id} in Pack 8 must have explicit dialogue array`);
        assert.equal(item.dialogue.length, 2, `${item.id} must have 2 speaker turns`);
        assert.equal(item.dialogue[0].speaker, 'A');
        assert.equal(item.dialogue[1].speaker, 'B');
        assert.doesNotMatch(item.dialogue[0].japanese, /[「」]/);
        assert.doesNotMatch(item.dialogue[1].japanese, /[「」]/);
        assert.equal(item.japanese, `A: ${item.dialogue[0].japanese} B: ${item.dialogue[1].japanese}`);
      }
    }
  }

  // 2. Pack 9: all 6 questions and all 6 follow-ups are ordinary single-speaker sentences (no dialogue array)
  for (const pat of pack9.patterns) {
    for (const q of pat.questions) {
      for (const item of [q, q.followUp]) {
        assert.equal(item.dialogue, undefined, `Ordinary sentence ${item.id} in Pack 9 must not have dialogue turns`);
      }
    }
  }

  // 3. Pack 10: conversational exercises use explicit dialogue turns; single-speaker exercises remain ordinary sentences
  const pack10Session = createContextSession(pack10);
  const expectedDialogueIds = new Set([
    'question:de-means-1',
    'followup:de-means-1',
    'question:particle-yo-ne-1',
    'followup:particle-yo-ne-1',
    'question:particle-yo-ne-2',
    'followup:particle-yo-ne-2',
  ]);
  for (const q of pack10Session.questions) {
    for (const item of [q, q.followUp]) {
      if (expectedDialogueIds.has(item.id)) {
        assert.ok(Array.isArray(item.dialogue) && item.dialogue.length === 2, `${item.id} must have 2 explicit dialogue turns`);
        assert.equal(item.dialogue[0].speaker, 'A');
        assert.equal(item.dialogue[1].speaker, 'B');
      } else {
        assert.equal(item.dialogue, undefined, `Ordinary sentence ${item.id} in Pack 10 must remain unchanged`);
      }
    }
  }

  // 4. Render checks in app.mjs for dialogue vs ordinary sentences, word help across turns, reading toggle, and cloze secrecy
  const appCode = fs.readFileSync('app.mjs', 'utf8');
  const c = vm.createContext({
    session: createContextSession(pack8),
    profile: () => ({ id: 'learner-1', name: 'Learner', progress: {}, contextPractice: {} }),
    getItem: () => null,
    glyph: () => '',
    scoreContextSession,
  });
  const renderSnippet = `
    const esc = value => String(value ?? '').replace(/[&<>\"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[ch]));
    const icon = () => '';
    ${appCode.slice(appCode.indexOf('function renderContextSession('), appCode.indexOf('function leaveSession('))}
  `;
  vm.runInContext(renderSnippet, c);

  // Q1 in Pack 8 (comprehension dialogue):
  // A: これは何ですか。
  // B: 日本語の本です。
  const htmlPack8Q1 = vm.runInContext('renderContextSession(session)', c);
  assert.match(htmlPack8Q1, /class="context-dialogue"/);
  assert.match(htmlPack8Q1, /<div class="context-dialogue-turn" data-speaker="A"><span class="context-speaker-label" aria-label="Speaker A">A:<\/span>/);
  assert.match(htmlPack8Q1, /<div class="context-dialogue-turn" data-speaker="B"><span class="context-speaker-label" aria-label="Speaker B">B:<\/span>/);
  assert.doesNotMatch(htmlPack8Q1, /context-dialogue-reading/, 'Readings hidden by default');

  // Toggle reading on -> each speaker turn shows its reading inside its turn
  c.session = { ...c.session, showReading: true };
  const htmlPack8Q1Reading = vm.runInContext('renderContextSession(session)', c);
  assert.match(htmlPack8Q1Reading, /これは なんですか。/);
  assert.match(htmlPack8Q1Reading, /にほんごの ほんです。/);

  // Tap a word in Speaker B's turn (index 6 is 日本語)
  const bWordIdx = c.session.questions[0].words.findIndex((w) => w.text === '日本語');
  assert.equal(bWordIdx, 6);
  c.session = setContextWordHelp(c.session, bWordIdx);
  const htmlPack8WordB = vm.runInContext('renderContextSession(session)', c);
  assert.match(htmlPack8WordB, /class="context-word-btn is-active"[^>]*data-word-index="6"[^>]*>日本語<\/button>/);
  assert.match(htmlPack8WordB, /class="context-word-help-text" lang="ja">日本語<\/strong>/);
  assert.match(htmlPack8WordB, /class="context-word-help-kana" lang="ja">にほんご<\/span>/);
  assert.match(htmlPack8WordB, /class="context-word-help-meaning">Japanese language<\/span>/);

  // Q2 in Pack 8 (cloze dialogue):
  // A: その箱の中は（　）ですか。
  // B: お茶です。
  c.session = { ...createContextSession(pack8), position: 1 };
  const htmlPack8Q2 = vm.runInContext('renderContextSession(session)', c);
  assert.match(htmlPack8Q2, /<span class="context-word-blank" aria-label="blank">（　）<\/span>/);
  assert.doesNotMatch(htmlPack8Q2, /<button[^>]*>（　）<\/button>/, 'Cloze blank must never be an interactive word button');

  // Ordinary sentence in Pack 9 Q1 renders <p class="context-sentence-jp"> without .context-dialogue
  c.session = createContextSession(pack9);
  const htmlPack9Q1 = vm.runInContext('renderContextSession(session)', c);
  assert.doesNotMatch(htmlPack9Q1, /class="context-dialogue"/);
  assert.match(htmlPack9Q1, /<p class="context-sentence-jp" lang="ja" aria-label="私は今、冷たい水がほしいです。">/);

  // 5. Validation rejects malformed dialogue structures
  assert.throws(
    () => validateContextPack({
      ...pack8Raw,
      patterns: [{
        ...pack8Raw.patterns[0],
        questions: [{
          ...pack8Raw.patterns[0].questions[0],
          dialogue: [{ speaker: 'A', japanese: 'これは何ですか。', words: pack8Raw.patterns[0].questions[0].dialogue[0].words }],
        }],
      }],
    }),
    /at least two speaker turns/
  );
  assert.throws(
    () => validateContextPack({
      ...pack8Raw,
      patterns: [{
        ...pack8Raw.patterns[0],
        questions: [{
          ...pack8Raw.patterns[0].questions[0],
          dialogue: [
            pack8Raw.patterns[0].questions[0].dialogue[0],
            { ...pack8Raw.patterns[0].questions[0].dialogue[1], speaker: 'C' },
          ],
        }],
      }],
    }),
    /must specify speaker "B"/
  );
});


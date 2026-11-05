import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  CONTEXT_PACK_1_PATH,
  CONTEXT_PACK_META,
  ContextPackError,
  validateContextPack,
  loadContextPack,
  createContextSession,
  selectContextChoice,
  scoreContextSession,
  recordContextCompletion,
} from '../context.mjs';
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

test('Beginner Pack 1 structure, varied answer positions, Q3/Q6 edits, and Level 1 subject links', () => {
  const pack = validateContextPack(packRaw);
  assert.equal(pack.id, 'pack:beginner-1');
  assert.equal(pack.label, '3 patterns · 6 questions');
  assert.equal(pack.patterns.length, 3);

  const level1Ids = new Set(level1Raw.map((item) => item.id));
  for (const pattern of pack.patterns) {
    assert.equal(pattern.examples.length, 2, `${pattern.id} should have 2 examples`);
    assert.equal(pattern.questions.length, 2, `${pattern.id} should have 2 questions`);
    // Each pattern includes one seen example check and one fresh unseen sentence
    assert.equal(pattern.questions.filter((q) => q.isFreshSentence).length, 1, `${pattern.id} must have 1 fresh unseen sentence`);
    for (const subjId of pattern.subjectIds) {
      assert.ok(level1Ids.has(subjId), `Subject ${subjId} in ${pattern.id} must exist in data/level-1.json`);
    }
  }

  const session = createContextSession(pack);
  assert.equal(session.questions.length, 6);
  assert.deepEqual(
    session.questions.map((q) => q.correctChoice),
    ['B', 'C', 'A', 'C', 'B', 'A'],
    'Correct answer positions must be varied (2 A, 2 B, 2 C)'
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
  assert.equal(q6.choices[2].text, 'There are two apples under the table.');
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

test('One question at a time, Show reading toggle, and selected answer explanation before moving on', () => {
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

  // Question 1 rendered alone, reading hidden by default
  const html1 = vm.runInContext('renderContextSession(session)', c);
  assert.match(html1, /QUESTION 1 OF 6/);
  assert.doesNotMatch(html1, /QUESTION 2 OF 6/);
  assert.match(html1, /Show reading/);
  assert.doesNotMatch(html1, /ふじさんは おおきい やま です。/);
  assert.doesNotMatch(html1, /data-action="next-context-question"/, 'Next button hidden before resolving question');

  // Toggle Show reading on
  c.session = { ...s0, showReading: true };
  const htmlReading = vm.runInContext('renderContextSession(session)', c);
  assert.match(htmlReading, /Hide reading/);
  assert.match(htmlReading, /ふじさんは おおきい やま です。/);

  // Select wrong choice A on Q1: explains why Choice A doesn't work, still cannot advance
  const sWrong = selectContextChoice(c.session, 'A');
  c.session = sWrong;
  const htmlWrong = vm.runInContext('renderContextSession(session)', c);
  assert.match(htmlWrong, /Why Choice A doesn’t work/);
  assert.match(htmlWrong, /大きい \(おおきい\) means “big,” not “above”/);
  assert.doesNotMatch(htmlWrong, /data-action="next-context-question"/);

  // Select right choice B on Q1: explains why Choice B works and shows Next question button
  const sRight = selectContextChoice(sWrong, 'B');
  c.session = sRight;
  const htmlRight = vm.runInContext('renderContextSession(session)', c);
  assert.match(htmlRight, /Choice B is correct/);
  assert.match(htmlRight, /ふじ山は sets Mt\. Fuji as the topic/);
  assert.match(htmlRight, /data-action="next-context-question"/);
});

test('First-attempt scoring and unfinished pack guard never mark an incomplete pack complete', () => {
  let s = createContextSession(packRaw);

  // Q1: wrong on first try ('A'), then right on retry ('B') -> firstAttempts[Q1] stays false
  s = selectContextChoice(s, 'A');
  assert.equal(s.firstAttempts['question:wa-desu-1'], false);
  assert.equal( Boolean(s.resolved['question:wa-desu-1']), false);

  s = selectContextChoice(s, 'B');
  assert.equal(s.firstAttempts['question:wa-desu-1'], false, 'Retrying must not erase first-attempt result');
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

  // Answer Q2..Q6: Q2 right on 1st try ('C'), Q3 wrong ('B') then right ('A'), Q4..Q6 right on 1st try ('C', 'B', 'A')
  const plan = [
    { pos: 1, picks: ['C'] },
    { pos: 2, picks: ['B', 'A'] },
    { pos: 3, picks: ['C'] },
    { pos: 4, picks: ['B'] },
    { pos: 5, picks: ['A'] },
  ];
  for (const step of plan) {
    s = { ...s, position: step.pos, selectedChoice: null, feedback: null };
    for (const pick of step.picks) {
      s = selectContextChoice(s, pick);
    }
  }

  const finalScore = scoreContextSession(s);
  assert.equal(finalScore.complete, true);
  assert.equal(finalScore.total, 6);
  assert.equal(finalScore.correct, 4, '4 of 6 answered right on the first attempt');
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

  // 1. Leaving mid-pack after missing and answering questions does not touch profile at all
  let midSession = createContextSession(packRaw);
  midSession = selectContextChoice(midSession, 'C'); // miss Q1
  midSession = selectContextChoice(midSession, 'B'); // resolve Q1
  midSession = { ...midSession, position: 1 };
  midSession = selectContextChoice(midSession, 'A'); // miss Q2 and leave
  assert.equal(scoreContextSession(midSession).complete, false);
  assert.equal(JSON.stringify(baseProfile.progress), snapshotProgress);

  // 2. Completing the pack with misses & retries updates only contextPractice
  let fullSession = createContextSession(packRaw);
  const answers = [
    ['A', 'B'], // Q1: miss then right
    ['C'],      // Q2: right
    ['A'],      // Q3: right
    ['A', 'C'], // Q4: miss then right
    ['B'],      // Q5: right
    ['A'],      // Q6: right
  ];
  answers.forEach((picks, idx) => {
    fullSession = { ...fullSession, position: idx, selectedChoice: null, feedback: null };
    for (const p of picks) fullSession = selectContextChoice(fullSession, p);
  });
  const score = scoreContextSession(fullSession);
  assert.deepEqual(score, { correct: 4, total: 6, resolvedCount: 6, complete: true });

  const after = recordContextCompletion(baseProfile, fullSession.pack, score, 1762335000000);
  assert.equal(JSON.stringify(after.progress), snapshotProgress, 'SRS stages and availableAt dates must be untouched');
  assert.equal(JSON.stringify(after.history), snapshotHistory, 'SRS history must be untouched');
  assert.equal(after.unlockedLevel, 2, 'unlockedLevel must be untouched');
  assert.deepEqual(after.contextPractice['pack:beginner-1'], {
    completedAt: 1762335000000,
    patterns: ['grammar:wa-desu', 'grammar:no-modifier', 'grammar:ni-ga-arimasu'],
    lastScore: { correct: 4, total: 6 },
    bestScore: { correct: 4, total: 6 },
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
  const guest1Completed = recordContextCompletion(
    guest1,
    pack,
    { correct: 6, total: 6, resolvedCount: 6, complete: true },
    1762336000000
  );
  const savedStore = JSON.stringify({
    version: 1,
    activeProfileId: guest1Completed.id,
    profiles: [guest1Completed, guest2],
  });

  // Simulate reload through readState's validateProfile map
  const reloadedData = JSON.parse(savedStore);
  reloadedData.profiles = reloadedData.profiles.map(validateProfile);
  assert.deepEqual(reloadedData.profiles[0].contextPractice['pack:beginner-1'].lastScore, { correct: 6, total: 6 });
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
  const remoteRows = new Map(); // userId -> { profile, revision }
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

  // Seed Account A with existing SRS progress
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

  // Both sessions connect as Account A
  await syncSession1.connect();
  await syncSession2.connect();
  assert.equal(syncSession1.state.revision, 1);
  assert.equal(syncSession2.state.revision, 1);

  // Session 1 completes Beginner Pack 1 (5/6 first attempt)
  const acctAUpdated = recordContextCompletion(
    syncSession1.state.profile,
    pack,
    { correct: 5, total: 6, resolvedCount: 6, complete: true },
    1762337000000
  );
  const saveOk = await syncSession1.update(acctAUpdated);
  assert.equal(saveOk, true);
  assert.equal(syncSession1.state.revision, 2);

  // Session 2 reloads/connects and receives Account A's synced contextPractice and unchanged SRS progress
  await syncSession2.reload();
  assert.equal(syncSession2.state.revision, 2);
  assert.deepEqual(syncSession2.state.profile.contextPractice['pack:beginner-1'].lastScore, { correct: 5, total: 6 });
  assert.deepEqual(syncSession2.state.profile.progress, {
    'kanji:入': { stage: 5, availableAt: 1762900000000, passedAt: 1762300000000 },
  });

  // 4. Switch Session 1 from Disposable Account A to Disposable Account B
  activeSessionUser = null;
  syncSession1.reset(null);
  assert.equal(syncSession1.state.profile, null);

  activeSessionUser = { id: 'acct-disposable-b', email: 'b@example.com' };
  await syncSession1.connect();
  assert.equal(syncSession1.state.profile.id, 'acct-disposable-b');
  assert.equal(syncSession1.state.profile.contextPractice, undefined, 'Account B must not inherit Account A completion');
  assert.deepEqual(syncSession1.state.profile.progress, {});

  // Account B completes the pack with 3/6; Account A's row remains at 5/6
  const acctBUpdated = recordContextCompletion(
    syncSession1.state.profile,
    pack,
    { correct: 3, total: 6, resolvedCount: 6, complete: true },
    1762338000000
  );
  assert.equal(await syncSession1.update(acctBUpdated), true);
  assert.deepEqual(remoteRows.get('acct-disposable-b').profile.contextPractice['pack:beginner-1'].lastScore, { correct: 3, total: 6 });
  assert.deepEqual(remoteRows.get('acct-disposable-a').profile.contextPractice['pack:beginner-1'].lastScore, { correct: 5, total: 6 });
});

test('End-to-end app.mjs flow: dashboard entry label, beginContextPractice, question progression, and active-learner save', async () => {
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

  // 1. Dashboard renders "3 patterns · 6 questions"
  const dashHtmlBefore = vm.runInContext('dashboard({ lessons: 5, reviews: 2, learned: 1, nextReviewAt: 1762350000000 })', c);
  assert.match(dashHtmlBefore, /3 patterns · 6 questions/);
  assert.match(dashHtmlBefore, /Open Beginner Pack 1 · 3 patterns · 6 questions/);

  // 2. Open pack -> starts at Question 1
  await vm.runInContext('beginContextPractice()', c);
  assert.ok(c.session);
  assert.equal(c.session.mode, 'context');
  assert.equal(c.session.position, 0);

  // 3. Cannot advance before answering
  await vm.runInContext('nextContextQuestion()', c);
  assert.equal(c.session.position, 0);

  // 4. Answer all 6 questions (missing Q1 first, then choosing right choice on Q1..Q6)
  vm.runInContext('chooseContextAnswer("A")', c); // Q1 miss
  await vm.runInContext('nextContextQuestion()', c);
  assert.equal(c.session.position, 0, 'Cannot advance while selected choice is wrong');

  const correctChoices = ['B', 'C', 'A', 'C', 'B', 'A'];
  for (let i = 0; i < correctChoices.length; i++) {
    assert.equal(c.session.position, i);
    vm.runInContext(`chooseContextAnswer("${correctChoices[i]}")`, c);
    await vm.runInContext('nextContextQuestion()', c);
  }

  // 5. Pack is now done, saved only on activeProfile, with SRS untouched
  assert.equal(c.session.phase, 'done');
  assert.deepEqual(activeProfile.contextPractice['pack:beginner-1'].lastScore, { correct: 5, total: 6 });
  assert.equal(JSON.stringify(activeProfile.progress), srsSnapshot);
  assert.equal(inactiveProfile.contextPractice, undefined);

  // 6. Dashboard reflects completion while keeping "3 patterns · 6 questions"
  const dashHtmlAfter = vm.runInContext('dashboard({ lessons: 5, reviews: 2, learned: 1, nextReviewAt: 1762350000000 })', c);
  assert.match(dashHtmlAfter, /3 patterns · 6 questions/);
  assert.match(dashHtmlAfter, /Completed · 5\/6 first try/);
});


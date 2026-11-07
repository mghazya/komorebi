import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME_PATH = '/Users/nene/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const LIVE_URL = 'https://mghazya.github.io/komorebi/';
const TEMP_USER_DATA_DIR = path.join(os.tmpdir(), `komorebi-srs-verify-${Date.now()}`);

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
      this.ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data);
        if (data.id && this.pending.has(data.id)) {
          const { resolve, reject } = this.pending.get(data.id);
          this.pending.delete(data.id);
          if (data.error) reject(new Error(data.error.message || JSON.stringify(data.error)));
          else resolve(data.result);
        }
      };
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.ws.close();
  }
}

// 1. Build a rich disposable learner profile with populated Radicals, Kanji, and Vocabulary
// across all 9 SRS stages and distinct review dates (overdue, near-future, distant-future, burned).
const NOW = Date.now();
const DISPOSABLE_PROFILE_ID = `disposable-populated-${NOW}`;

const POPULATED_PROGRESS = {
  // Radicals across stages 1, 5, 9
  'radical:barb': { stage: 1, availableAt: NOW - 3600000 * 3 }, // Apprentice I, overdue by 3h
  'radical:big': { stage: 5, availableAt: NOW + 3600000 * 48, passedAt: NOW - 3600000 * 72 }, // Guru I, due in 2d
  'radical:construction': { stage: 9, availableAt: 0, burnedAt: NOW - 86400000 * 90 }, // Burned, 90d ago

  // Kanji across stages 2, 4, 7
  'kanji:上': { stage: 2, availableAt: NOW + 3600000 * 8 }, // Apprentice II, due in 8h
  'kanji:下': { stage: 4, availableAt: NOW - 60000 }, // Apprentice IV, due now
  'kanji:大': { stage: 7, availableAt: NOW + 86400000 * 14, passedAt: NOW - 86400000 * 30 }, // Master, due in 14d

  // Vocabulary across stages 3, 6, 8
  'vocabulary:上': { stage: 3, availableAt: NOW + 3600000 * 24 }, // Apprentice III, due in 24h
  'vocabulary:大人': { stage: 6, availableAt: NOW + 86400000 * 7, passedAt: NOW - 86400000 * 21 }, // Guru II, due in 7d
  'vocabulary:一人': { stage: 8, availableAt: NOW + 86400000 * 30, passedAt: NOW - 86400000 * 60 }, // Enlightened, due in 30d
};

const INITIAL_PROGRESS_SNAPSHOT = JSON.stringify(POPULATED_PROGRESS);

const DISPOSABLE_STATE = {
  version: 1,
  activeProfileId: DISPOSABLE_PROFILE_ID,
  profiles: [
    {
      id: DISPOSABLE_PROFILE_ID,
      name: 'Populated Verification Learner',
      createdAt: NOW - 86400000 * 10,
      progress: JSON.parse(INITIAL_PROGRESS_SNAPSHOT),
      history: [
        { type: 'review', id: 'radical:big', at: NOW - 3600000 * 72 },
        { type: 'review', id: 'kanji:大', at: NOW - 86400000 * 30 },
        { type: 'review', id: 'vocabulary:大人', at: NOW - 86400000 * 21 },
      ],
      settings: { batchSize: 5 },
    },
  ],
};

async function main() {
  console.log('=== STARTING POPULATED SRS ISOLATION VERIFICATION ===');
  console.log(`Disposable User Data Dir: ${TEMP_USER_DATA_DIR}`);
  console.log(`Initial SRS progress items count: ${Object.keys(POPULATED_PROGRESS).length}`);
  console.log('SRS Stages represented: 1 (Apprentice I), 2 (II), 3 (III), 4 (IV), 5 (Guru I), 6 (II), 7 (Master), 8 (Enlightened), 9 (Burned)');

  fs.mkdirSync(TEMP_USER_DATA_DIR, { recursive: true });

  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9229',
    `--user-data-dir=${TEMP_USER_DATA_DIR}`,
    '--no-sandbox',
    '--disable-gpu',
  ]);

  let wsUrl = null;
  for (let i = 0; i < 30; i++) {
    await wait(200);
    try {
      const res = await fetch('http://127.0.0.1:9229/json/list');
      const list = await res.json();
      if (list && list[0] && list[0].webSocketDebuggerUrl) {
        wsUrl = list[0].webSocketDebuggerUrl;
        break;
      }
    } catch {}
  }

  if (!wsUrl) {
    chrome.kill();
    throw new Error('Failed to connect to Chrome debugging port');
  }

  const client = new CDPClient(wsUrl);
  await client.connect();

  await client.send('Page.enable');
  await client.send('DOM.enable');
  await client.send('Runtime.enable');
  await client.send('Network.enable');

  // Handle any JavaScript dialogs automatically
  client.ws.addEventListener('message', async (msg) => {
    const data = JSON.parse(msg.data);
    if (data.method === 'Page.javascriptDialogOpening') {
      try {
        await client.send('Page.handleJavaScriptDialog', { accept: true });
      } catch {}
    }
  });

  // Inject populated disposable state into localStorage before any script runs
  const stateJsonStr = JSON.stringify(DISPOSABLE_STATE);
  await client.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.confirm = () => true;
      try {
        localStorage.setItem('komorebi.study.v1', ${JSON.stringify(stateJsonStr)});
      } catch (e) {
        console.error('Failed to pre-seed localStorage', e);
      }
    `,
  });

  console.log(`Navigating to ${LIVE_URL}...`);
  await client.send('Page.navigate', { url: LIVE_URL });

  // Wait for dashboard to load
  let loaded = false;
  for (let i = 0; i < 50; i++) {
    await wait(400);
    const check = await client.send('Runtime.evaluate', {
      expression: 'Boolean(document.querySelector("[data-action=context-practice]"))',
      returnByValue: true,
    });
    if (check.result.value) {
      loaded = true;
      console.log(`Dashboard loaded in ${(i + 1) * 0.4}s.`);
      break;
    }
  }

  if (!loaded) {
    chrome.kill();
    throw new Error('Timed out waiting for dashboard to load.');
  }

  // Verify the disposable profile was loaded properly
  const profileCheck = await client.send('Runtime.evaluate', {
    expression: `(() => {
      const raw = localStorage.getItem('komorebi.study.v1');
      const state = raw ? JSON.parse(raw) : null;
      const prof = state?.profiles?.find(p => p.id === state.activeProfileId);
      return {
        profileName: prof?.name,
        profileId: prof?.id,
        progressCount: Object.keys(prof?.progress || {}).length,
        progressSnapshot: JSON.stringify(prof?.progress || {})
      };
    })()`,
    returnByValue: true,
  });

  console.log('Loaded Profile Check:', profileCheck.result.value.profileName, 'ID:', profileCheck.result.value.profileId);
  console.log('Progress Items Count:', profileCheck.result.value.progressCount);

  if (profileCheck.result.value.progressSnapshot !== INITIAL_PROGRESS_SNAPSHOT) {
    throw new Error('Profile progress did not match expected pre-seeded populated state!');
  }

  // Define helper inside page context
  await client.send('Runtime.evaluate', {
    expression: `
      window.__waitFor = async (selector, timeoutMs = 8000) => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          const el = document.querySelector(selector);
          if (el) return el;
          await new Promise(r => setTimeout(r, 100));
        }
        throw new Error('Timeout waiting for selector: ' + selector);
      };
    `,
  });

  // Step 1: Open Beginner Pack 1
  console.log('\n--- STEP 1: Open Beginner Pack 1 ---');
  await client.send('Runtime.evaluate', {
    expression: `(async () => {
      const pack1Btn = await window.__waitFor('[data-action="context-practice"][data-pack="pack:beginner-1"]');
      pack1Btn.click();
      await window.__waitFor('.context-sentence-jp');
    })()`,
    awaitPromise: true,
  });
  console.log('Pack 1 opened successfully.');

  // Step 2: In Question 1, perform word lookups
  console.log('\n--- STEP 2: Word Lookups in Question 1 ---');
  const wordLookupResult = await client.send('Runtime.evaluate', {
    expression: `(async () => {
      // Lookup word 0 (ふじ山)
      const fujiBtn = await window.__waitFor('.context-word-btn[data-word-index="0"]');
      fujiBtn.click();
      await window.__waitFor('.context-word-help-card');
      const w0 = {
        text: document.querySelector('.context-word-help-text')?.textContent.trim(),
        kana: document.querySelector('.context-word-help-kana')?.textContent.trim(),
        romaji: document.querySelector('.context-word-help-romaji')?.textContent.trim(),
        meaning: document.querySelector('.context-word-help-meaning')?.textContent.trim()
      };

      // Lookup word 1 (は)
      const waBtn = document.querySelector('.context-word-btn[data-word-index="1"]');
      waBtn.click();
      await new Promise(r => setTimeout(r, 150));
      const w1 = {
        text: document.querySelector('.context-word-help-text')?.textContent.trim(),
        kana: document.querySelector('.context-word-help-kana')?.textContent.trim(),
        romaji: document.querySelector('.context-word-help-romaji')?.textContent.trim(),
        meaning: document.querySelector('.context-word-help-meaning')?.textContent.trim()
      };

      // Close word help
      document.querySelector('.context-word-help-close')?.click();
      await new Promise(r => setTimeout(r, 150));

      return { w0, w1 };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  console.log('Word lookups verified:', wordLookupResult.result.value);

  // Step 3: Deliberately select an INCORRECT answer, verify explanation, verify choice preservation with word help
  console.log('\n--- STEP 3: Incorrect Answer & Word Help Preservation ---');
  const incorrectResult = await client.send('Runtime.evaluate', {
    expression: `(async () => {
      // Correct choice for Q1 (ふじ山は大きい山です。) is "Mt. Fuji is a big mountain." (Choice B)
      // We deliberately click Choice A (distractor: "Mt. Fuji is above the mountain.")
      const choiceA = document.querySelector('[data-context-choice="A"]');
      choiceA.click();
      await new Promise(r => setTimeout(r, 200));

      const feedback = document.querySelector('.context-feedback');
      const isFeedbackIncorrect = feedback?.classList.contains('incorrect');
      const feedbackText = feedback?.textContent.trim();

      // Tap word help while incorrect answer is active
      const wordBtn = document.querySelector('.context-word-btn[data-word-index="2"]'); // 大きい
      wordBtn.click();
      await new Promise(r => setTimeout(r, 150));

      // Re-query Choice A to ensure selected state is preserved
      const refreshedChoiceA = document.querySelector('[data-context-choice="A"]');
      const isChoicePreserved = refreshedChoiceA?.classList.contains('is-incorrect') &&
                                refreshedChoiceA?.getAttribute('aria-pressed') === 'true';

      const followUpBtn = document.querySelector('[data-action="start-context-followup"]');

      return {
        isFeedbackIncorrect,
        feedbackText,
        isChoicePreserved,
        hasFollowUpBtn: Boolean(followUpBtn)
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  console.log('Incorrect answer result:', incorrectResult.result.value);
  if (!incorrectResult.result.value.isFeedbackIncorrect || !incorrectResult.result.value.isChoicePreserved) {
    throw new Error('Incorrect answer feedback or choice preservation failed');
  }

  // Step 4: Click "Try follow-up question", perform word lookup in follow-up, answer correctly, advance
  console.log('\n--- STEP 4: Fresh Follow-up Question Flow ---');
  const followUpResult = await client.send('Runtime.evaluate', {
    expression: `(async () => {
      const followUpBtn = document.querySelector('[data-action="start-context-followup"]');
      followUpBtn.click();
      await window.__waitFor('.is-followup');

      const followUpSentence = document.querySelector('.context-sentence-jp')?.textContent.trim();
      const followUpEyebrow = document.querySelector('.context-question-top .eyebrow')?.textContent.trim();

      // Word lookup in follow-up sentence
      const fuWordBtn = document.querySelector('.context-word-btn[data-word-index="0"]');
      fuWordBtn.click();
      await window.__waitFor('.context-word-help-card');
      const fuWordText = document.querySelector('.context-word-help-text')?.textContent.trim();

      // Close word help
      document.querySelector('.context-word-help-close')?.click();
      await new Promise(r => setTimeout(r, 150));

      // Answer follow-up correctly (Follow-up sentence: 川は小さい川です。 Choice A: "The river is a small river.")
      const choiceA = document.querySelector('[data-context-choice="A"]');
      choiceA.click();
      await new Promise(r => setTimeout(r, 200));

      const isResolved = Boolean(document.querySelector('[data-action="next-context-question"]'));

      return {
        followUpSentence,
        followUpEyebrow,
        fuWordText,
        isResolved
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  console.log('Follow-up result:', followUpResult.result.value);

  // Step 5: Complete Questions 2 through 6 through to completion screen
  console.log('\n--- STEP 5: Complete Remaining Questions 2 through 6 ---');
  const completionResult = await client.send('Runtime.evaluate', {
    expression: `(async () => {
      for (let q = 1; q < 6; q++) {
        // Click Next question
        const nextBtn = await window.__waitFor('[data-action="next-context-question"]');
        nextBtn.click();
        await window.__waitFor('.context-question-box');
        await new Promise(r => setTimeout(r, 200));

        // Perform a quick word lookup in this question
        const wBtn = document.querySelector('.context-word-btn');
        if (wBtn) {
          wBtn.click();
          await new Promise(r => setTimeout(r, 100));
          document.querySelector('.context-word-help-close')?.click();
          await new Promise(r => setTimeout(r, 100));
        }

        // Click choices until resolved
        for (const letter of ['A', 'B', 'C']) {
          const choice = document.querySelector('[data-context-choice="' + letter + '"]');
          if (choice && !choice.disabled) {
            choice.click();
            await new Promise(r => setTimeout(r, 150));
            // If follow-up appeared, clear it
            const fuBtn = document.querySelector('[data-action="start-context-followup"]');
            if (fuBtn) {
              fuBtn.click();
              await window.__waitFor('.is-followup');
              for (const fuLetter of ['A', 'B', 'C']) {
                const fuChoice = document.querySelector('[data-context-choice="' + fuLetter + '"]');
                if (fuChoice && !fuChoice.disabled) {
                  fuChoice.click();
                  await new Promise(r => setTimeout(r, 150));
                  if (document.querySelector('[data-action="next-context-question"]')) break;
                }
              }
            }
            if (document.querySelector('[data-action="next-context-question"]')) break;
          }
        }
      }

      // Finish pack
      const finishBtn = await window.__waitFor('[data-action="next-context-question"]');
      finishBtn.click();
      await window.__waitFor('.session-done.context-done');

      const doneTitle = document.querySelector('.session-done h1')?.textContent.trim();
      const doneRecap = document.querySelector('.result-cards')?.textContent.trim();

      // Return to dashboard
      const dashBtn = await window.__waitFor('[data-action="finish"]');
      dashBtn.click();
      await window.__waitFor('[data-action="context-practice"]');

      return {
        doneTitle,
        doneRecap
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  console.log('Session completion result:', completionResult.result.value);

  // Step 6: Verify final SRS progress against initial populated snapshot
  console.log('\n--- STEP 6: VERIFY POPULATED SRS PROGRESS INVARIANCE ---');
  const finalStorageCheck = await client.send('Runtime.evaluate', {
    expression: `(() => {
      const raw = localStorage.getItem('komorebi.study.v1');
      const state = raw ? JSON.parse(raw) : null;
      const prof = state?.profiles?.find(p => p.id === state.activeProfileId);
      return {
        profileName: prof?.name,
        profileId: prof?.id,
        contextPracticeRecorded: prof?.contextPractice?.['pack:beginner-1'] || null,
        finalProgress: prof?.progress || {},
        finalProgressSnapshot: JSON.stringify(prof?.progress || {})
      };
    })()`,
    returnByValue: true,
  });

  const finalData = finalStorageCheck.result.value;
  console.log('Context practice recorded:', JSON.stringify(finalData.contextPracticeRecorded, null, 2));

  if (!finalData.contextPracticeRecorded || !finalData.contextPracticeRecorded.completedAt) {
    throw new Error('Context practice completion was NOT recorded in profile!');
  }

  console.log('\nDetailed Item-by-Item SRS Progress Comparison:');
  let hasMismatches = false;
  for (const [subjId, initialItem] of Object.entries(POPULATED_PROGRESS)) {
    const finalItem = finalData.finalProgress[subjId];
    const initialJson = JSON.stringify(initialItem);
    const finalJson = JSON.stringify(finalItem);
    const matches = initialJson === finalJson;
    console.log(`  ${subjId.padEnd(25)}: initial=${initialJson} | final=${finalJson} -> ${matches ? 'MATCH ✔' : 'MISMATCH ❌'}`);
    if (!matches) hasMismatches = true;
  }

  if (hasMismatches) {
    throw new Error('One or more populated SRS progress items were modified during context practice!');
  }

  if (finalData.finalProgressSnapshot !== INITIAL_PROGRESS_SNAPSHOT) {
    throw new Error('Overall SRS progress snapshot mismatch!');
  }

  console.log('\n✔ TASK 1 VERIFIED: All 9 populated SRS items (stages 1-9 across Radicals, Kanji, and Vocabulary) remained 100% untouched!');

  client.close();
  chrome.kill();
  fs.rmSync(TEMP_USER_DATA_DIR, { recursive: true, force: true });
}

main().catch((err) => {
  console.error('\n❌ VERIFICATION FAILED:', err);
  process.exit(1);
});

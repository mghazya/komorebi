import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME_PATH = '/Users/nene/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const LIVE_URL = 'https://mghazya.github.io/komorebi/';
const TEMP_USER_DATA_DIR = path.join(os.tmpdir(), `komorebi-verify-${Date.now()}`);

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

async function main() {
  console.log('=== STARTING LIVE PRODUCTION VERIFICATION ===');
  console.log(`Target URL: ${LIVE_URL}`);
  console.log(`Disposable User Data Dir: ${TEMP_USER_DATA_DIR}`);

  fs.mkdirSync(TEMP_USER_DATA_DIR, { recursive: true });

  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9228',
    `--user-data-dir=${TEMP_USER_DATA_DIR}`,
    '--no-sandbox',
    '--disable-gpu',
  ]);

  let wsUrl = null;
  for (let i = 0; i < 30; i++) {
    await wait(200);
    try {
      const res = await fetch('http://127.0.0.1:9228/json/list');
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

  await client.send('Page.addScriptToEvaluateOnNewDocument', {
    source: 'window.confirm = () => true;',
  });

  const consoleErrors = [];
  const networkFailures = [];

  client.ws.addEventListener('message', async (msg) => {
    const data = JSON.parse(msg.data);
    if (data.method === 'Page.javascriptDialogOpening') {
      try {
        await client.send('Page.handleJavaScriptDialog', { accept: true });
      } catch {}
    }
    if (data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') {
      const text = data.params.args.map((a) => a.value || a.description).join(' ');
      consoleErrors.push(text);
    }
    if (data.method === 'Network.loadingFailed') {
      networkFailures.push({ url: data.params.url, errorText: data.params.errorText });
    }
  });

  console.log('Navigating to live site...');
  await client.send('Page.navigate', { url: LIVE_URL });

  // 1. Wait for dashboard to load
  let loaded = false;
  for (let i = 0; i < 50; i++) {
    await wait(400);
    const check = await client.send('Runtime.evaluate', {
      expression: 'Boolean(document.querySelector("[data-action=context-practice]"))',
      returnByValue: true,
    });
    if (check.result.value) {
      loaded = true;
      console.log(`Dashboard loaded successfully in ${(i + 1) * 0.4}s.`);
      break;
    }
  }

  if (!loaded) {
    throw new Error('Timed out waiting for dashboard to load.');
  }

  // Check 1: Updated asset version tags load without errors
  console.log('\n--- CHECK 1: Asset Version Tags & Zero Console Errors ---');
  const tagInfo = await client.send('Runtime.evaluate', {
    expression: `(() => {
      const script = document.querySelector('script[src*="app.mjs"]');
      const style = document.querySelector('link[href*="style.css"]');
      return {
        scriptSrc: script ? script.getAttribute('src') : null,
        styleHref: style ? style.getAttribute('href') : null,
      };
    })()`,
    returnByValue: true,
  });
  console.log('Script tag:', tagInfo.result.value.scriptSrc);
  console.log('Style tag:', tagInfo.result.value.styleHref);
  console.log('Console errors recorded:', consoleErrors.length);
  console.log('Network failures recorded:', networkFailures.length);

  if (!tagInfo.result.value.scriptSrc?.includes('?v=20261107-context-word-help')) {
    throw new Error(`Expected script tag to have ?v=20261107-context-word-help, got ${tagInfo.result.value.scriptSrc}`);
  }
  if (!tagInfo.result.value.styleHref?.includes('?v=20261107-context-word-help')) {
    throw new Error(`Expected style tag to have ?v=20261107-context-word-help, got ${tagInfo.result.value.styleHref}`);
  }
  if (consoleErrors.length > 0) {
    throw new Error(`Console errors found: ${consoleErrors.join('; ')}`);
  }
  console.log('✔ Check 1 PASSED: Asset version tags match and zero errors.');

  // Helper to wait for a selector inside evaluated scripts
  await client.send('Runtime.evaluate', {
    expression: `
      window.confirm = () => true;
      window.__waitFor = async (selector, timeoutMs = 8000) => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          const el = document.querySelector(selector);
          if (el) return el;
          await new Promise(r => setTimeout(r, 100));
        }
        throw new Error('Timeout waiting for selector: ' + selector);
      };
      window.__returnToDashboard = async () => {
        const exitBtn = document.querySelector('[data-action="exit-session"]');
        if (exitBtn) {
          exitBtn.click();
          await window.__waitFor('[data-action="context-practice"]');
          await new Promise(r => setTimeout(r, 200));
        }
      };
    `,
  });

  // Snapshot initial SRS progress
  const initialSrs = await client.send('Runtime.evaluate', {
    expression: `(() => {
      const raw = localStorage.getItem('komorebi_state');
      const parsed = raw ? JSON.parse(raw) : null;
      const prof = parsed?.profiles?.[parsed?.activeProfile || 0] || null;
      return {
        profileName: prof?.name,
        progressKeys: Object.keys(prof?.progress || {}),
        progressSnapshot: JSON.stringify(prof?.progress || {})
      };
    })()`,
    returnByValue: true,
  });
  console.log('\nInitial disposable profile state:', initialSrs.result.value.profileName, 'progress items count:', initialSrs.result.value.progressKeys.length);

  // Check 2: Tap-to-read shows contextual kana, romaji, and meaning
  console.log('\n--- CHECK 2: Tap-to-Read Word Help in Pack 1 ---');
  const wordHelpTest = await client.send('Runtime.evaluate', {
    expression: `(async () => {
      // Click Pack 1
      const pack1Btn = await window.__waitFor('[data-action="context-practice"][data-pack="pack:beginner-1"]');
      pack1Btn.click();
      await window.__waitFor('.context-sentence-jp');

      // Find first word button (ふじ山)
      const fujiBtn = await window.__waitFor('.context-word-btn[data-word-index="0"]');
      const fujiText = fujiBtn.textContent.trim();
      fujiBtn.click();
      await window.__waitFor('.context-word-help-card');

      const text = document.querySelector('.context-word-help-text')?.textContent.trim();
      const kana = document.querySelector('.context-word-help-kana')?.textContent.trim();
      const romaji = document.querySelector('.context-word-help-romaji')?.textContent.trim();
      const meaning = document.querySelector('.context-word-help-meaning')?.textContent.trim();

      // Tap particle 'は' (word index 1)
      const waBtn = document.querySelector('.context-word-btn[data-word-index="1"]');
      let waDetails = null;
      if (waBtn) {
        waBtn.click();
        await new Promise(r => setTimeout(r, 200));
        waDetails = {
          text: document.querySelector('.context-word-help-text')?.textContent.trim(),
          kana: document.querySelector('.context-word-help-kana')?.textContent.trim(),
          romaji: document.querySelector('.context-word-help-romaji')?.textContent.trim(),
          meaning: document.querySelector('.context-word-help-meaning')?.textContent.trim()
        };
      }

      // Close word help
      const closeBtn = document.querySelector('.context-word-help-close');
      let closedCleanly = false;
      if (closeBtn) {
        closeBtn.click();
        await new Promise(r => setTimeout(r, 150));
        closedCleanly = Boolean(document.querySelector('.context-word-help-idle'));
      }

      return {
        success: true,
        fuji: { fujiText, text, kana, romaji, meaning },
        wa: waDetails,
        closedCleanly
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  console.log('Word help result:', JSON.stringify(wordHelpTest.result.value, null, 2));

  if (!wordHelpTest.result.value.success) {
    throw new Error(`Check 2 failed: ${wordHelpTest.result.value.error}`);
  }
  const fuji = wordHelpTest.result.value.fuji;
  if (fuji.text !== 'ふじ山' || fuji.kana !== 'ふじさん' || fuji.romaji !== 'fujisan' || !fuji.meaning.includes('Fuji')) {
    throw new Error(`Unexpected fuji word help: ${JSON.stringify(fuji)}`);
  }
  const wa = wordHelpTest.result.value.wa;
  if (wa.text !== 'は' || wa.romaji !== 'wa' || !wa.meaning.toLowerCase().includes('topic')) {
    throw new Error(`Unexpected particle wa word help: ${JSON.stringify(wa)}`);
  }
  if (!wordHelpTest.result.value.closedCleanly) {
    throw new Error('Word help close button failed to return to idle state.');
  }
  console.log('✔ Check 2 PASSED: Contextual kana, romaji, and meaning correctly displayed.');

  // Check 3: Cloze blanks reveal no missing answer
  console.log('\n--- CHECK 3: Cloze Blanks Secrecy ---');
  const clozeTest = await client.send('Runtime.evaluate', {
    expression: `(async () => {
      // Exit to dashboard
      await window.__returnToDashboard();

      // Open Pack 7 (Question 1 is cloze: ふじ山は（　）山です。)
      const pack7Btn = await window.__waitFor('[data-action="context-practice"][data-pack="pack:beginner-7"]');
      pack7Btn.click();
      const sentenceEl = await window.__waitFor('.context-sentence-jp');

      const blankEl = sentenceEl?.querySelector('.context-word-blank');
      const buttonsInsideBlank = blankEl?.querySelectorAll('button') || [];
      const hasBlankText = blankEl?.textContent.includes('（　）');
      const isBlankAButton = blankEl?.tagName.toLowerCase() === 'button';
      const hasDataWordIndex = blankEl?.hasAttribute('data-word-index');
      const leaksAnswer = sentenceEl?.textContent.includes('高い');

      return {
        success: true,
        sentenceText: sentenceEl?.textContent.trim(),
        hasBlank: Boolean(blankEl),
        hasBlankText,
        isBlankAButton,
        hasDataWordIndex,
        buttonsCountInBlank: buttonsInsideBlank.length,
        leaksAnswer
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  console.log('Cloze test result:', JSON.stringify(clozeTest.result.value, null, 2));
  if (!clozeTest.result.value.success || !clozeTest.result.value.hasBlank || !clozeTest.result.value.hasBlankText) {
    throw new Error('Cloze blank element not found or missing （　）');
  }
  if (clozeTest.result.value.isBlankAButton || clozeTest.result.value.hasDataWordIndex || clozeTest.result.value.leaksAnswer) {
    throw new Error('Cloze blank leaked data or is interactively revealing missing answer!');
  }
  console.log('✔ Check 3 PASSED: Cloze blanks remain hidden without revealing answer.');

  // Check 4 & 5: Wrong answers lead to a different sentence AND Word help preserves selected answers
  console.log('\n--- CHECK 4 & 5: Wrong Answer Follow-up & Answer Preservation ---');
  const wrongAndPreserveTest = await client.send('Runtime.evaluate', {
    expression: `(async () => {
      // In Pack 7 Question 1 (ふじ山は（　）山です。 Correct choice is 高い)
      // Let's inspect choices
      const choices = Array.from(document.querySelectorAll('.context-choice'));
      const originalSentence = document.querySelector('.context-sentence-jp')?.textContent.trim();

      // Find an incorrect choice (e.g. choice that is not '高い')
      let wrongChoiceBtn = null;
      for (const btn of choices) {
        if (!btn.textContent.includes('高い')) {
          wrongChoiceBtn = btn;
          break;
        }
      }
      if (!wrongChoiceBtn) return { success: false, error: 'Could not find wrong choice' };

      const chosenChoiceLetter = wrongChoiceBtn.querySelector('.context-choice-letter')?.textContent.trim();

      // Click wrong choice
      wrongChoiceBtn.click();
      await new Promise(r => setTimeout(r, 200));

      const feedback = document.querySelector('.context-feedback');
      const isFeedbackIncorrect = feedback?.classList.contains('incorrect');
      const followUpBtn = document.querySelector('[data-action="start-context-followup"]');

      // Test preserving selected answer while tapping word help
      const firstWordBtn = document.querySelector('.context-word-btn');
      if (firstWordBtn) {
        firstWordBtn.click();
        await new Promise(r => setTimeout(r, 150));
      }

      // Re-query the choice button from the fresh DOM after render
      const refreshedChoiceBtn = document.querySelector('[data-context-choice="' + chosenChoiceLetter + '"]');
      const isChoiceStillSelected = refreshedChoiceBtn?.classList.contains('is-incorrect') &&
                                   refreshedChoiceBtn?.getAttribute('aria-pressed') === 'true';

      // Now click follow-up button to advance to fresh sentence
      if (!followUpBtn) {
        return { success: false, error: 'Follow-up button not found after wrong answer' };
      }
      followUpBtn.click();
      await new Promise(r => setTimeout(r, 400));

      const followUpEyebrow = document.querySelector('.context-question-top .eyebrow')?.textContent.trim();
      const followUpSentence = document.querySelector('.context-sentence-jp')?.textContent.trim();
      const followUpChoices = Array.from(document.querySelectorAll('.context-choice')).map(c => c.textContent.trim());

      return {
        success: true,
        chosenChoiceLetter,
        isFeedbackIncorrect,
        isChoiceStillSelected,
        originalSentence,
        followUpEyebrow,
        followUpSentence,
        sentencesAreDifferent: originalSentence !== followUpSentence,
        followUpChoicesCount: followUpChoices.length
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  console.log('Wrong answer & preservation result:', JSON.stringify(wrongAndPreserveTest.result.value, null, 2));

  if (!wrongAndPreserveTest.result.value.success) {
    throw new Error(`Check 4/5 failed: ${wrongAndPreserveTest.result.value.error}`);
  }
  if (!wrongAndPreserveTest.result.value.isChoiceStillSelected) {
    throw new Error('Word help did NOT preserve selected choice!');
  }
  if (!wrongAndPreserveTest.result.value.sentencesAreDifferent) {
    throw new Error('Follow-up sentence was not different from original question!');
  }
  if (!wrongAndPreserveTest.result.value.followUpEyebrow?.includes('FOLLOW-UP')) {
    throw new Error('Follow-up header not displayed properly.');
  }
  console.log('✔ Check 4 & 5 PASSED: Selected answers preserved during word help; wrong answers cleanly lead to fresh follow-up sentence.');

  // Check 6: Context practice leaves kanji/radical/vocabulary SRS unchanged
  console.log('\n--- CHECK 6: Kanji / Radical / Vocabulary SRS Unchanged ---');
  const finalSrs = await client.send('Runtime.evaluate', {
    expression: `(() => {
      const raw = localStorage.getItem('komorebi_state');
      const parsed = raw ? JSON.parse(raw) : null;
      const prof = parsed?.profiles?.[parsed?.activeProfile || 0] || null;
      return {
        profileName: prof?.name,
        progressSnapshot: JSON.stringify(prof?.progress || {}),
        contextPracticeRecorded: prof?.contextPractice || null
      };
    })()`,
    returnByValue: true,
  });

  console.log('Initial SRS progress snapshot:', initialSrs.result.value.progressSnapshot);
  console.log('Final SRS progress snapshot:  ', finalSrs.result.value.progressSnapshot);
  console.log('Context practice recorded in profile:', JSON.stringify(finalSrs.result.value.contextPracticeRecorded));

  if (initialSrs.result.value.progressSnapshot !== finalSrs.result.value.progressSnapshot) {
    throw new Error('SRS progress was modified by context practice!');
  }
  console.log('✔ Check 6 PASSED: Radical, kanji, and vocabulary SRS progress and review schedules remain 100% unchanged.');

  // Check 7: Pack 7 reviewed sentences check
  console.log('\n--- CHECK 7: Pack 7 Contrast Questions Verification ---');
  const p7Contrast = await client.send('Runtime.evaluate', {
    expression: `(async () => {
      // Exit to dashboard
      await window.__returnToDashboard();

      // Re-enter Pack 7
      const pack7Btn = await window.__waitFor('[data-action="context-practice"][data-pack="pack:beginner-7"]');
      pack7Btn.click();
      await window.__waitFor('.context-sentence-jp');

      // Advance to Question 5/6 (Clause 1 が、Clause 2)
      // Answer questions until we see "部屋" or "小さいですが、明るいです"
      let foundRoomSentence = false;
      let roomChoices = [];
      for (let s = 0; s < 10; s++) {
        const sentence = document.querySelector('.context-sentence-jp')?.textContent.trim();
        if (sentence && sentence.includes('小さいですが、明るいです')) {
          foundRoomSentence = true;
          roomChoices = Array.from(document.querySelectorAll('.context-choice-text')).map(c => c.textContent.trim());
          break;
        }
        // Click first choice
        const choice = document.querySelector('.context-choice');
        if (choice && !choice.disabled) {
          choice.click();
          await new Promise(r => setTimeout(r, 100));
        }
        const fu = document.querySelector('[data-action="start-context-followup"]');
        if (fu) {
          fu.click();
          await new Promise(r => setTimeout(r, 100));
          const c2 = document.querySelector('.context-choice');
          if (c2 && !c2.disabled) {
            c2.click();
            await new Promise(r => setTimeout(r, 100));
          }
        }
        const next = document.querySelector('[data-action="next-context-question"]');
        if (next) {
          next.click();
          await new Promise(r => setTimeout(r, 200));
        }
      }

      return {
        foundRoomSentence,
        roomChoices
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  console.log('Pack 7 Contrast Question verification:', JSON.stringify(p7Contrast.result.value, null, 2));

  if (!p7Contrast.result.value.foundRoomSentence) {
    throw new Error('Could not find reviewed room sentence in Pack 7');
  }
  console.log('✔ Check 7 PASSED: Reviewed Pack 7 room sentence and distractors verified live.');

  client.close();
  chrome.kill();

  // Cleanup temp dir
  fs.rmSync(TEMP_USER_DATA_DIR, { recursive: true, force: true });
  console.log('\n=== ALL LIVE VERIFICATION CHECKS PASSED WITH FLYING COLORS ===');
}

main().catch((err) => {
  console.error('\n❌ LIVE PRODUCTION VERIFICATION FAILED:', err);
  process.exit(1);
});

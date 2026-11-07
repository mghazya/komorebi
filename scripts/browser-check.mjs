import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME_PATH = '/Users/nene/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const SCREENSHOT_PATH = '/Users/nene/.gemini/antigravity/brain/fce2c65d-1063-4768-962b-c00d1fa0233e/longest-word-help-360px-200pct.png';

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.events = new Map();
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
  console.log('Launching headless Chrome for 360px + 200% text layout check...');
  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--window-size=360,800',
    '--no-sandbox',
    '--disable-gpu',
  ]);

  chrome.stderr.on('data', (d) => {
    // console.log('[Chrome]', d.toString());
  });

  // Wait for Chrome to open debugging port
  let wsUrl = null;
  for (let i = 0; i < 30; i++) {
    await wait(200);
    try {
      const res = await fetch('http://127.0.0.1:9222/json/list');
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

  console.log('Connected to Chrome WebSocket:', wsUrl);
  const client = new CDPClient(wsUrl);
  await client.connect();

  await client.send('Page.enable');
  await client.send('DOM.enable');
  await client.send('Runtime.enable');

  // Override device metrics: 360px viewport width
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 360,
    height: 800,
    deviceScaleFactor: 2,
    mobile: true,
  });

  // Apply 200% text size (WCAG 1.4.4 text zoom test)
  await client.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.fontSize = '200%';
      });
    `,
  });

  console.log('Navigating to http://localhost:8080/ ...');
  await client.send('Page.navigate', { url: 'http://localhost:8080/' });
  await wait(1200);

  // Script to open Beginner Pack 6, jump to Question 6, and tap the longest word: 下げませんでした
  console.log('Navigating to Pack 6 Question 6 and opening "下げませんでした" word help...');
  const evalResult = await client.send('Runtime.evaluate', {
    expression: `
      (async () => {
        // Open Pack 6
        const pack6Btn = document.querySelector('[data-action="context-practice"][data-pack="pack:beginner-6"]');
        if (!pack6Btn) throw new Error('Pack 6 button not found on dashboard');
        pack6Btn.click();
        await new Promise(r => setTimeout(r, 600));

        // Advance to Question 6 (Question 6 has "女の人は大きい箱を下げませんでした。")
        for (let step = 0; step < 10; step++) {
          const sentence = document.querySelector('.context-sentence-jp');
          if (sentence && sentence.textContent.includes('下げませんでした')) {
            break;
          }
          // Click choices until resolved
          for (const letter of ['A', 'B', 'C']) {
            const choiceBtn = document.querySelector('[data-context-choice="' + letter + '"]');
            if (choiceBtn && !choiceBtn.disabled) {
              choiceBtn.click();
              await new Promise(r => setTimeout(r, 50));
            }
          }
          const followUpBtn = document.querySelector('[data-action="start-context-followup"]');
          if (followUpBtn) {
            followUpBtn.click();
            await new Promise(r => setTimeout(r, 100));
            for (const letter of ['A', 'B', 'C']) {
              const choiceBtn = document.querySelector('[data-context-choice="' + letter + '"]');
              if (choiceBtn && !choiceBtn.disabled) {
                choiceBtn.click();
                await new Promise(r => setTimeout(r, 50));
              }
            }
          }
          const nextBtn = document.querySelector('[data-action="next-context-question"]');
          if (nextBtn) {
            nextBtn.click();
            await new Promise(r => setTimeout(r, 200));
          }
        }

        // Tap "下げませんでした"
        const wordBtns = Array.from(document.querySelectorAll('.context-word-btn'));
        const targetBtn = wordBtns.find(b => b.textContent.includes('下げませんでした'));
        if (!targetBtn) throw new Error('Target word button "下げませんでした" not found');
        targetBtn.click();
        await new Promise(r => setTimeout(r, 300));

        return { ok: true };
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  });

  if (evalResult.exceptionDetails) {
    console.error('Eval error:', evalResult.exceptionDetails);
    chrome.kill();
    process.exit(1);
  }

  console.log('Word help opened. Measuring browser layout at 360px + 200% text size...');
  const measurements = await client.send('Runtime.evaluate', {
    expression: `
      (() => {
        const docEl = document.documentElement;
        const body = document.body;
        const questionBox = document.querySelector('.context-question-box');
        const tray = document.querySelector('.context-word-help-tray');
        const card = document.querySelector('.context-word-help-card');
        const main = document.querySelector('.context-word-help-main');
        const text = document.querySelector('.context-word-help-text');
        const kana = document.querySelector('.context-word-help-kana');
        const romaji = document.querySelector('.context-word-help-romaji');
        const meaning = document.querySelector('.context-word-help-meaning');
        const closeBtn = document.querySelector('.context-word-help-close');
        const choices = Array.from(document.querySelectorAll('.context-choice'));

        const trayRect = tray ? tray.getBoundingClientRect() : null;
        const cardRect = card ? card.getBoundingClientRect() : null;
        const mainRect = main ? main.getBoundingClientRect() : null;
        const closeRect = closeBtn ? closeBtn.getBoundingClientRect() : null;
        const choiceRects = choices.map(c => {
          const r = c.getBoundingClientRect();
          return {
            letter: c.querySelector('.context-choice-letter')?.textContent,
            top: r.top,
            bottom: r.bottom,
            left: r.left,
            right: r.right,
            width: r.width,
            height: r.height,
            visible: r.width > 0 && r.height > 0 && r.bottom > 0
          };
        });

        return {
          windowInnerWidth: window.innerWidth,
          windowInnerHeight: window.innerHeight,
          htmlClientWidth: docEl.clientWidth,
          htmlScrollWidth: docEl.scrollWidth,
          hasHorizontalScroll: docEl.scrollWidth > docEl.clientWidth,
          bodyClientWidth: body.clientWidth,
          bodyScrollWidth: body.scrollWidth,
          tray: trayRect ? {
            top: trayRect.top,
            bottom: trayRect.bottom,
            left: trayRect.left,
            right: trayRect.right,
            width: trayRect.width,
            height: trayRect.height,
            scrollWidth: tray.scrollWidth,
            clientWidth: tray.clientWidth,
            trayOverflows: tray.scrollWidth > tray.clientWidth
          } : null,
          card: cardRect ? {
            width: cardRect.width,
            height: cardRect.height,
            scrollWidth: card.scrollWidth,
            clientWidth: card.clientWidth,
            cardOverflows: card.scrollWidth > card.clientWidth
          } : null,
          main: mainRect ? {
            width: mainRect.width,
            height: mainRect.height,
            scrollWidth: main.scrollWidth,
            clientWidth: main.clientWidth,
            mainOverflows: main.scrollWidth > main.clientWidth
          } : null,
          text: text ? text.textContent : null,
          kana: kana ? kana.textContent : null,
          romaji: romaji ? romaji.textContent : null,
          meaning: meaning ? meaning.textContent : null,
          closeButton: closeRect ? {
            top: closeRect.top,
            bottom: closeRect.bottom,
            left: closeRect.left,
            right: closeRect.right,
            width: closeRect.width,
            height: closeRect.height,
            isWithinViewport: closeRect.left >= 0 && closeRect.right <= window.innerWidth,
            isClickable: closeRect.width >= 32 && closeRect.height >= 32
          } : null,
          choices: choiceRects,
          allChoicesReachable: choiceRects.length === 3 && choiceRects.every(c => c.visible && c.top >= (trayRect?.bottom || 0))
        };
      })()
    `,
    returnByValue: true,
  });

  console.log('\n=== BROWSER MEASUREMENTS (ACTUAL HEADLESS CHROME) ===');
  console.log(JSON.stringify(measurements.result.value, null, 2));

  // Capture screenshot of the full viewport
  console.log('\nCapturing screenshot to', SCREENSHOT_PATH);
  const screenshotData = await client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
  });

  fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(screenshotData.data, 'base64'));
  console.log('Screenshot saved successfully. File size:', fs.statSync(SCREENSHOT_PATH).size, 'bytes');

  client.close();
  chrome.kill();
  console.log('Browser test complete.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

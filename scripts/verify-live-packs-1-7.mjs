import { spawn } from 'node:child_process';

const CHROME_PATH = '/Users/nene/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const LIVE_URL = 'https://mghazya.github.io/komorebi/';

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
  console.log(`Connecting to ${LIVE_URL} via headless Chrome...`);
  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9227',
    '--no-sandbox',
    '--disable-gpu',
  ]);

  let wsUrl = null;
  for (let i = 0; i < 30; i++) {
    await wait(200);
    try {
      const res = await fetch('http://127.0.0.1:9227/json/list');
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

  // Auto-accept confirm dialogs if any appear
  await client.send('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {});

  console.log(`Navigating to ${LIVE_URL}...`);
  await client.send('Page.navigate', { url: LIVE_URL });

  // Wait until curriculum is loaded and dashboard renders
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

  // Override window.confirm to always return true
  await client.send('Runtime.evaluate', {
    expression: 'window.confirm = () => true;',
  });

  const packResults = [];
  for (let p = 1; p <= 7; p++) {
    const packId = `pack:beginner-${p}`;
    const res = await client.send('Runtime.evaluate', {
      expression: `(async () => {
        // Return to dashboard first if in practice view
        const exitBtn = document.querySelector('[data-action="exit-session"]');
        if (exitBtn) {
          exitBtn.click();
          await new Promise(r => setTimeout(r, 300));
        }

        const packBtn = document.querySelector('[data-action="context-practice"][data-pack="${packId}"]');
        if (!packBtn) {
          return { pack: "${packId}", found: false, error: "Button not found on dashboard" };
        }
        packBtn.click();
        await new Promise(r => setTimeout(r, 400));

        const questionBox = document.querySelector('.context-question-box');
        const patternBox = document.querySelector('.context-pattern-box');
        const patternTitle = patternBox?.querySelector('.context-pattern-title')?.textContent.trim();
        const sentenceEl = document.querySelector('.context-sentence-jp');
        const choices = Array.from(document.querySelectorAll('.context-choice'));

        return {
          pack: "${packId}",
          found: true,
          hasQuestionBox: !!questionBox,
          pattern: patternTitle,
          sentence: sentenceEl ? sentenceEl.textContent.trim() : null,
          choicesCount: choices.length
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    packResults.push(res.result.value);
  }

  console.log('\nPack verification results:');
  console.log(JSON.stringify(packResults, null, 2));

  client.close();
  chrome.kill();

  const allFound = packResults.every((r) => r.found && r.hasQuestionBox && r.choicesCount === 3);
  if (!allFound) {
    throw new Error('Some packs failed to open properly');
  }
  console.log('\nSTEP 1 VERIFIED: All packs 1-7 open and display cleanly on live site!');
}

main().catch((err) => {
  console.error('Error during live verification:', err);
  process.exit(1);
});

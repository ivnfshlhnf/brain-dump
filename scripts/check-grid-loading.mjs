// Loading-state check: a cold cache shows one quiet line while the Vault read runs. The bug
// this guards (finding 05): the still-loading grid rendered `<div class="grid"></div>` — with
// no cached cards there was nothing at all, and a cold cache (the phone's first visit) sat
// blank for the whole Vault read, reading as "empty" rather than "loading". The empty-Vault
// placeholder is correctly gated on cardsLoaded; the loading state showed nothing.
//
// Measured in a real browser: with a cold cache and a held-open Vault read, the grid must
// carry "Reading the Vault…" (live to screen readers) and the capture control must stay
// available; when the read completes the line hands off to the empty-Vault placeholder.
//
//   node scripts/check-grid-loading.mjs [url]   — bare, it starts its own dev server;
//                                                 pass a URL to reuse one already running
import { chromium } from 'playwright';
import { seedStore } from './lib/check-harness.mjs';

const urlArg = process.argv.slice(2).find((a) => !a.startsWith('--'));

let server = null;
let url = urlArg;
if (!url) {
  const { createServer } = await import('vite');
  server = await createServer({ server: { port: 0 }, logLevel: 'error' });
  await server.listen();
  url = server.resolvedUrls.local[0];
}

// A dead port: nothing listens here, so the only way the Vault read is slow is our route
// handler holding it — which makes the loading state observable.
const COUCH = 'http://127.0.0.1:5999';

const browser = await chromium.launch();

let pass = true;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  // Hold every Vault request open until the assertions below have run, then let it fail.
  let release;
  const held = new Promise((res) => (release = res));
  await page.route('**/127.0.0.1:5999/**', async (route) => {
    await held;
    await route.abort();
  });

  await page.goto(url, { waitUntil: 'load' });
  // note-cards stays empty: this is a cold cache.
  await seedStore(page, {
    stores: ['note-cards', 'settings'],
    settings: { couchdbUrl: COUCH, couchdbDb: 'obsidian' },
  });
  await page.reload({ waitUntil: 'load' });

  // While the read is held open: the loading line is on, live, and capture is not gated.
  await page.waitForSelector('.grid .card-placeholder', { timeout: 5000 });
  const during = await page.evaluate(() => ({
    text: document.querySelector('.grid .card-placeholder')?.textContent.trim(),
    live: document.querySelector('.grid .card-placeholder')?.getAttribute('aria-live'),
    capture: document.querySelector('.ctl-catch') !== null,
  }));
  const duringOk = during.text === 'Reading the Vault…' && during.live === 'polite' && during.capture;
  if (!duringOk) pass = false;
  console.log(`while loading ${JSON.stringify(during)} → ${duringOk ? 'ok' : 'FAIL'}`);

  // Release the read; it fails, cardsLoaded flips, and the empty-Vault placeholder takes over.
  release();
  await page.waitForSelector('text=Your first thought will land here.', { timeout: 15000 });
  const after = await page.evaluate(() => ({
    loadingGone: ![...document.querySelectorAll('.grid .card-placeholder')].some((el) =>
      el.textContent.includes('Reading the Vault'),
    ),
  }));
  if (!after.loadingGone) pass = false;
  console.log(`after the read ${JSON.stringify(after)} → ${after.loadingGone ? 'ok' : 'FAIL'}`);

  await context.close();
} finally {
  await browser.close();
  if (server) await server.close();
}

if (!pass) {
  console.error('A cold cache must show a quiet loading line in the grid, then hand off.');
  process.exit(1);
}
console.log('The loading grid speaks, and hands off cleanly to the empty Vault.');
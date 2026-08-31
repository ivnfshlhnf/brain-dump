// Log-durability check: the diagnostics log survives a reload, and Export hands over the
// retained events in the dev log file's exact format. The bug this guards (host ticket 02):
// the in-memory ring buffer died with the page — a phone-only failure ended the session and
// took its own evidence with it, and the diagnostic path that found the dogfooding findings
// existed only where a dev server does.
//
// Measured in a real browser: with events seeded into the durable log store (yesterday's
// session), a fresh page load must hydrate them into the Settings list, and Export must
// yield one JSON object per line — byte-for-byte what the dev middleware would have
// appended. The in-memory events logged after boot ride along with them.
//
//   node scripts/check-log-export.mjs [url]   — bare, it starts its own dev server;
//                                               pass a URL to reuse one already running
import { chromium } from 'playwright';

const urlArg = process.argv.slice(2).find((a) => !a.startsWith('--'));

let server = null;
let url = urlArg;
if (!url) {
  const { createServer } = await import('vite');
  server = await createServer({ server: { port: 0 }, logLevel: 'error' });
  await server.listen();
  url = server.resolvedUrls.local[0];
}

// Yesterday's session: two events with a dead-Vault shape, seeded straight into IndexedDB
// so the check's only input is the durable store itself.
const SEEDED = [
  { at: Date.now() - 60000, level: 'info', op: 'capture', message: 'yesterday: capture started' },
  {
    at: Date.now() - 30000,
    level: 'error',
    op: 'http',
    message: 'yesterday: chat request failed',
    detail: { url: '/chat/completions', status: 500 },
  },
];

// A dead port: the Vault read fails fast, and nothing here needs it to succeed.
const COUCH = 'http://127.0.0.1:5999';

const browser = await chromium.launch();

let pass = true;
try {
  const page = await (
    await browser.newContext({ viewport: { width: 1280, height: 900 } })
  ).newPage();

  await page.route('**/127.0.0.1:5999/**', (route) => route.abort());

  await page.goto(url, { waitUntil: 'load' });

  // Seed the durable store as if a previous session had written it, then reload — a fresh
  // boot over yesterday's log.
  await page.evaluate(async ({ couch, seeded }) => {
    const db = await new Promise((res, rej) => {
      // The seeded page evaluates before the app's module can have created the schema, so
      // mirror the open here — version and stores exactly as src/lib/idb.ts walks them.
      const r = indexedDB.open('brain-dump', 6);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('log'))
          d.createObjectStore('log', { keyPath: 'seq', autoIncrement: true });
        if (!d.objectStoreNames.contains('note-cards')) d.createObjectStore('note-cards');
        if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction(['log', 'note-cards', 'settings'], 'readwrite');
      tx.objectStore('settings').put({ couchdbUrl: couch, couchdbDb: 'obsidian' }, 'current');
      for (const event of seeded) tx.objectStore('log').add({ event });
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, { couch: COUCH, seeded: SEEDED });
  await page.reload({ waitUntil: 'load' });

  // Hydration: the seeded (previous session's) events must appear in the Settings list.
  await page.click('[aria-label="settings"]');
  await page.waitForSelector('.diagnostics li', { timeout: 5000 });
  const listed = await page.evaluate(() => document.querySelectorAll('.diagnostics li').length);
  // The seeded two, plus whatever this session has logged since boot.
  if (listed < 2) pass = false;
  console.log(`events listed after reload → ${listed} ${listed >= 2 ? 'ok' : 'FAIL'}`);

  const hasSeeded = await page.evaluate(
    () =>
      document.querySelector('.diagnostics')?.textContent.includes('yesterday: capture started') ??
      false,
  );
  if (!hasSeeded) pass = false;
  console.log(`hydrated from the durable store → ${hasSeeded ? 'ok' : 'FAIL'}`);

  // Export: intercept the blob and read it back — it must be the dev file's exact format:
  // one JSON.stringify(event) per line, newline-terminated.
  await page.evaluate(() => {
    window.__lastBlob = null;
    URL.createObjectURL = (blob) => {
      window.__lastBlob = blob;
      return 'blob:stub';
    };
  });
  await page.click('button:has-text("Export JSONL")');
  const lines = await page.evaluate(() =>
    new Response(window.__lastBlob).text().then((t) => t.split('\n').filter(Boolean)),
  );
  const events = lines.map((l) => JSON.parse(l));
  const capture = events.filter((e) => e.message === 'yesterday: capture started');
  const failed = events.find((e) => e.message === 'yesterday: chat request failed');
  const ok =
    capture.length === 1 && // hydrated once, not duplicated
    events.every((e, i) => JSON.stringify(e) === lines[i]) && // byte-roundtrip
    failed?.detail.status === 500; // detail survived storage and back
  if (!ok) pass = false;
  console.log(
    `export lines: ${events.length}, seeded events byte-roundtrip → ${ok ? 'ok' : 'FAIL'}`,
  );

  await page.close();
} finally {
  await browser.close();
  if (server) await server.close();
}

if (!pass) {
  console.error('The log must survive a reload, and export in the dev log file format.');
  process.exit(1);
}
console.log('The log survives the reload; Export speaks the dev log format.');
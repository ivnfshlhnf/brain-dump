// Layout regression check: the grid is steady under a sheet. The bug this guards: the
// status strip sat above the card grids in the same flex column, wrapped in `{#if !sheet}`
// — so opening a sheet unmounted it, the grids reflowed into the freed space, and closing
// reflowed them back. With the sheet's exit animated, the jump was visible in the sliver of
// grid the falling sheet reveals. The strip is "never inside a sheet" by occlusion — a sheet
// is a full-screen opaque modal — so it keeps its box and is simply covered.
//
// Measured in a real browser: the card grid's bounding box must be identical before, during,
// and after a sheet, and the strip must stay in the DOM throughout.
//
//   node scripts/check-grid-steady.mjs [url]   — bare, it starts its own dev server;
//                                                pass a URL to reuse one already running
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

const PATH = 'Brain Dump/2026-08-21-water-the-plants.md';
const card = {
  path: PATH,
  title: 'Water the plants',
  category: 'personal',
  summary: 'A reminder to water the plants twice a day while the heat lasts.',
  tags: ['home', 'plants', 'basil'],
  createdAt: Date.UTC(2026, 7, 21, 20, 30, 45),
};

async function seedStore(page) {
  await page.evaluate(async (card) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('brain-dump', 5);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction(['note-cards', 'settings'], 'readwrite');
      tx.objectStore('note-cards').put([card], 'all');
      tx.objectStore('settings').put(
        { couchdbUrl: 'http://127.0.0.1:1', couchdbDb: 'brain-dump' },
        'current',
      );
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, card);
}

const browser = await chromium.launch();

let pass = true;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await seedStore(page);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.card--door', { timeout: 5000 });
  await page.waitForTimeout(350); // the rise finishes over 280ms

  // The grid's box, measured as a plain object so before/during/after compare exactly.
  const measure = () =>
    page.evaluate(() => {
      const grid = document.querySelector('.grid');
      const strip = document.querySelector('.status-strip');
      const r = grid.getBoundingClientRect();
      return { gridTop: r.top, gridHeight: r.height, stripPresent: strip !== null };
    });

  const before = await measure();

  // Open the sheet (the app's own card → openNote → showModal flow) and measure beneath it.
  await page.click('.card--door');
  await page.waitForSelector('dialog.sheet:modal', { timeout: 5000 });
  await page.waitForTimeout(350);
  const during = await measure();

  // Close it through the app's animated exit and measure once the grid is back.
  await page.click('.sheet__close');
  await page.waitForTimeout(500);
  const after = await measure();

  const steady = (a, b) => a.gridTop === b.gridTop && a.gridHeight === b.gridHeight;
  const ok = before.stripPresent && during.stripPresent && after.stripPresent &&
    steady(before, during) && steady(before, after);
  if (!ok) pass = false;
  console.log(
    `before ${JSON.stringify(before)}, during ${JSON.stringify(during)}, after ${JSON.stringify(after)} → ${ok ? 'ok' : 'FAIL'}`,
  );
  await context.close();
} finally {
  await browser.close();
  if (server) await server.close();
}

if (!pass) {
  console.error('The grid reflows under a sheet — the strip must keep its box, not unmount.');
  process.exit(1);
}
console.log('The grid is steady under a sheet; the strip keeps its box.');
// Layout regression check: the Note sheet scrolls a long Note (the card is a document, not
// a grid tile). The bug this guards: `.note` carries `overflow: hidden` (the burn edge, the
// card corners), and a flex item whose overflow is not `visible` has no automatic minimum
// size — so as a child of the scrolling `.sheet__body` it shrank to the body's height and
// clipped there, the body never overflowed, and no scrollbar ever appeared. The fix is
// `.sheet__body > .note { flex: none; }`; this check asserts the behaviour, not the rule.
//
// jsdom cannot see flex layout, so this is Playwright against the real stylesheet — the same
// discipline as scripts/shot-note.mjs: seed the card cache, reload, click the card (the app's
// own openNote → showModal flow), inject a long Note into the real open sheet, and measure.
//
//   node scripts/check-sheet-scroll.mjs [url]   — bare, it starts its own dev server;
//                                                 pass a URL to reuse one already running
import { chromium } from 'playwright';

const urlArg = process.argv.slice(2).find((a) => !a.startsWith('--'));

// Bare, the check is self-sufficient: it starts its own vite dev server on a random port
// (npm test runs it this way) and tears it down when done. A URL argument reuses a server
// that is already up, the way the shot-*.mjs scripts are driven by hand.
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

// A Note many screens tall — far past anything that fits, so the body must scroll or the
// check fails. Mirrors the Note sheet markup in src/App.svelte (`{:else if noteView}`).
const longNoteHtml = `
  <article class="note committed">
    <p class="eyebrow"><span class="filed-mark">Filed</span><span class="eyebrow__sep" aria-hidden="true">·</span>${PATH}</p>
    <h2>Water the plants</h2>
    <div class="note-body">${'I keep forgetting to water the plants, and the basil is wilting again. '.repeat(120)}</div>
    <p class="rule-label">key points</p>
    <ul>${'<li>Water the basil twice a day in the heat</li>'.repeat(30)}</ul>
  </article>`;

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
  // Desktop and phone: the clip showed wherever the sheet is taller than its content's room,
  // and the phone is where the room is scarcest.
  for (const vp of [
    { name: 'desktop', width: 1280, height: 900 },
    { name: 'phone', width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load' });
    await seedStore(page);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.card--door', { timeout: 5000 });
    await page.click('.card--door');
    await page.waitForSelector('dialog.sheet:modal', { timeout: 5000 });
    await page.waitForTimeout(350); // the sheet rises over 280ms

    await page.evaluate((html) => {
      document.querySelector('.sheet__body').innerHTML = html;
      document.querySelector('.sheet__foot .status')?.remove();
    }, longNoteHtml)
    await page.waitForTimeout(150);

    const m = await page.evaluate(() => {
      const body = document.querySelector('.sheet__body');
      const article = document.querySelector('.sheet__body > .note');
      const lastLi = [...document.querySelectorAll('.sheet__body li')].at(-1);
      const foot = document.querySelector('.sheet__foot');
      return {
        bodyScrollable: body.scrollHeight > body.clientHeight + 1,
        articleUnclipped: article.clientHeight >= article.scrollHeight - 1,
        lastPointBelowFold: lastLi.getBoundingClientRect().top > body.clientHeight,
        footPinned:
          foot.getBoundingClientRect().bottom <= document.documentElement.clientHeight + 1,
      };
    });

    const ok =
      m.bodyScrollable && m.articleUnclipped && m.lastPointBelowFold && m.footPinned;
    if (!ok) pass = false;
    console.log(
      `${vp.name}: ${JSON.stringify(m)} → ${ok ? 'ok' : 'FAIL'}`,
    );
    await context.close();
  }
} finally {
  await browser.close();
  if (server) await server.close();
}

if (!pass) {
  console.error(
    'The Note sheet does not scroll its long Note — `.sheet__body > .note` must keep its natural height.',
  );
  process.exit(1);
}
console.log('The long Note scrolls; the bar and the footer stay put.');
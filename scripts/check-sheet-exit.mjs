// Layout/behaviour regression check: the sheet's way out is animated, like its way in.
// The bug this guards: every close funnelled into `sheetEl.close()`, which synchronously
// removes the dialog from the top layer — so the rise had an answer and the return had
// none. The fix is a shared `closeSheet()` that plays `sheet-down` and closes on its
// animationend, with Esc/back-gesture intercepted at `cancel` and routed the same way.
//
// Measured in a real browser (jsdom sees neither layout nor animation): close the Note
// sheet and, mid-exit, the dialog must still be rendered and moving; after the exit it
// must be gone and the sheet state fully closed. Reduced motion is checked too — there
// the exit is instant, by design.
//
//   node scripts/check-sheet-exit.mjs [url]   — bare, it starts its own dev server;
//                                               pass a URL to reuse one already running
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

const PATH = 'Brain Dump/2026-08-21-water-the-plants.md';
const card = {
  path: PATH,
  title: 'Water the plants',
  category: 'personal',
  summary: 'A reminder to water the plants twice a day while the heat lasts.',
  tags: ['home', 'plants', 'basil'],
  createdAt: Date.UTC(2026, 7, 21, 20, 30, 45),
};

// Open the app's own Note sheet (card → openNote → showModal), return the dialog handle.
async function openNoteSheet(page) {
  await page.goto(url, { waitUntil: 'load' });
  await seedStore(page, {
    stores: ['note-cards', 'settings'],
    cards: [card],
    settings: { couchdbUrl: 'http://127.0.0.1:1', couchdbDb: 'brain-dump' },
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.card--door', { timeout: 5000 });
  await page.click('.card--door');
  await page.waitForSelector('dialog.sheet:modal', { timeout: 5000 });
  await page.waitForTimeout(350); // the rise finishes over 280ms
}

const browser = await chromium.launch();

let pass = true;
try {
  // --- animated exit: the close control -----------------------------------------------
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await openNoteSheet(page);

    // Sample immediately after the click: mid-exit the dialog must still be rendered and
    // moving (a transform in flight), not already display:none.
    await page.click('.sheet__close');
    const mid = await page.evaluate(() => {
      const d = document.querySelector('dialog.sheet');
      if (!d) return { present: false };
      const cs = getComputedStyle(d);
      return {
        present: true,
        rendered: cs.display !== 'none',
        moving: cs.transform !== 'none',
        animating: d.getAnimations().some((a) => a.playState === 'running'),
      };
    });

    // And after the exit has had time to finish, the sheet is fully gone.
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => {
      const d = document.querySelector('dialog.sheet');
      return { present: d !== null, open: d?.open ?? false };
    });

    const ok = mid.present && mid.rendered && mid.moving && mid.animating && !after.present;
    if (!ok) pass = false;
    console.log(`close control: mid-exit ${JSON.stringify(mid)}, after ${JSON.stringify(after)} → ${ok ? 'ok' : 'FAIL'}`);
    await context.close();
  }

  // --- animated exit: Esc (the platform close request, arriving as `cancel`) ----------
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await openNoteSheet(page);

    await page.keyboard.press('Escape');
    const mid = await page.evaluate(() => {
      const d = document.querySelector('dialog.sheet');
      if (!d) return { present: false };
      const cs = getComputedStyle(d);
      return { present: true, rendered: cs.display !== 'none', moving: cs.transform !== 'none' };
    });
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => ({ present: document.querySelector('dialog.sheet') !== null }));

    const ok = mid.present && mid.rendered && mid.moving && !after.present;
    if (!ok) pass = false;
    console.log(`esc: mid-exit ${JSON.stringify(mid)}, after ${JSON.stringify(after)} → ${ok ? 'ok' : 'FAIL'}`);
    await context.close();
  }

  // --- reduced motion: the exit is instant, no substitute animation --------------------
  {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await openNoteSheet(page);

    await page.click('.sheet__close');
    await page.waitForTimeout(150); // the instant close still needs a frame to unmount
    const after = await page.evaluate(() => ({ present: document.querySelector('dialog.sheet') !== null }));

    const ok = !after.present;
    if (!ok) pass = false;
    console.log(`reduced motion: after ${JSON.stringify(after)} → ${ok ? 'ok' : 'FAIL'}`);
    await context.close();
  }
} finally {
  await browser.close();
  if (server) await server.close();
}

if (!pass) {
  console.error('The sheet closes without its exit animation — closeSheet() must play sheet-down before close().');
  process.exit(1);
}
console.log('The return is animated like the rise; Esc and reduced motion behave.');
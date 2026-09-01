// The update-pickup check (found while dogfooding 2026-09-01): the *found-an-update*
// path of Settings → "Check for updates", on the real built worker. check-offline-shell
// already asserts the nothing-newer press ("This is the latest build."); this one
// deploys a second build under the running page and requires the press to answer on the
// spot — check-only, by decision the same day: it reports "Update downloaded" and never
// reloads; the reopen serves the new build.
//
// The bug it pins: the decision once read `registration.installing` alone, one snapshot
// after `await registration.update()`. Chromium resolves that promise while the new
// worker is still installing, so desktop passed by luck; WebKit (the phone) resolves it
// after the install finished — `installing` null, the worker already claiming — and the
// press answered "This is the latest build." while the new worker held the page. The
// interim apply-in-place design (reload, restore the sheet, keep its scroll) is gone;
// a reload or a "latest" answer here is a regression.
//
//   node scripts/check-update-pickup.mjs   — builds twice, serves dist/ via vite preview,
//                                            presses the real button between builds
//
// Requires Node ≥ 20.19 (the engines field) — the shared gate, scripts/lib/check-harness.mjs.
import { chromium } from 'playwright';
import { ensureNode, seedStore } from './lib/check-harness.mjs';

ensureNode();

const { build, preview } = await import('vite');

// A dead port: the Vault read can go nowhere, like the phone after a redeploy of nothing.
const COUCH = 'http://127.0.0.1:5999';

await build({ logLevel: 'error' });
const previewServer = await preview({ preview: { port: 0, host: '127.0.0.1' } });
const url = previewServer.resolvedUrls.local[0];

/** Polled by hand, deliberately: page.waitForFunction does not await a promise-returning
 *  predicate (a returned Promise is always truthy), so a wait written that way passes on
 *  its first tick. This loops until the worker registration is actually there. */
async function swReady(page) {
  for (let i = 0; i < 75; i++) {
    if (await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('the service worker never became ready');
}

/** The build identity the page actually loaded — the hashed chunk name, which differs
 *  between builds of even the same commit (the bundle embeds its builtAt). */
async function loadedChunk(page) {
  return page.evaluate(() => {
    const chunk = performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .find((n) => n.includes('assets/index-') && n.endsWith('.js'));
    return chunk ? chunk.split('/').pop() : null;
  });
}

const browser = await chromium.launch();
let pass = true;
try {
  // A phone-sized viewport: the phone is where every one of these symptoms was found.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  await page.goto(url, { waitUntil: 'load' });
  await seedStore(page, {
    stores: ['settings'],
    settings: { couchdbUrl: COUCH, couchdbDb: 'obsidian' },
  });
  await swReady(page);
  const chunkA = await loadedChunk(page);

  // Press 1 — nothing newer at the origin: the honest "latest" line.
  await page.click('.masthead__gear');
  await page.waitForSelector('text=Check for updates', { timeout: 5000 });
  await page.click('text=Check for updates');
  const press1 = await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('.hint')].some((el) =>
          el.textContent.includes('This is the latest build.'),
        ),
      { timeout: 15000 },
    )
    .then(() => 'latest')
    .catch(() => 'wrong');
  console.log(`press with nothing newer → ${press1 === 'latest' ? 'ok' : 'FAIL'}`);
  if (press1 !== 'latest') pass = false;

  // The redeploy: a second build of the same source — new chunk hash, new sw.js.
  await build({ logLevel: 'error' });

  // Press 2 — a newer build IS at the origin. The press is check-only (by decision,
  // 2026-09-01): it must answer on the spot — "Update downloaded — it takes over when
  // you reopen the app." — and stay exactly where it is. A reload here is the old
  // apply-in-place design resurfacing; "This is the latest build." here is the original
  // misreport. Both are regressions this check exists to catch.
  await page.waitForSelector('text=Check for updates', { timeout: 5000 });
  await page.click('text=Check for updates');
  const navigated = page
    .waitForEvent('load', { timeout: 5000 })
    .then(() => 'reloaded')
    .catch(() => 'no-reload');
  const answered = page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('.hint')].some((el) =>
          el.textContent.includes('Update downloaded'),
        ),
      { timeout: 15000 },
    )
    .then(() => 'answered')
    .catch(() => 'no-answer');
  const outcome = await Promise.race([navigated, answered]);
  const outcomeOk = outcome === 'answered';
  console.log(`press with a newer build on the origin → ${outcome} → ${outcomeOk ? 'ok' : 'FAIL'}`);
  if (!outcomeOk) pass = false;

  // The press must not have moved anything: check-only means the sheet is still open,
  // where it was, with the answer in it.
  const sheetKept = await page.locator('dialog[aria-label="Settings"]').isVisible();
  console.log(`the press keeps the Settings sheet open → ${sheetKept ? 'ok' : 'FAIL'}`);
  if (!sheetKept) pass = false;

  // The race above ends at the answer, but the contract is "never reloads" — full stop.
  // So keep watching for a load event after the answer too: a reload that arrives late
  // is the old apply-in-place design resurfacing just the same.
  const late = await navigated;
  const lateOk = late === 'no-reload';
  console.log(`the press never reloads, even after answering → ${late} → ${lateOk ? 'ok' : 'FAIL'}`);
  if (!lateOk) pass = false;

  // The reopen — what the message promises — must serve the second build. A human takes
  // a second to close and reopen the PWA; the check mirrors that with a fresh page in
  // the same context (same install, new document) rather than a reload of the pressed
  // page. "Settled" first, or the reopen races the install and the old worker still
  // serves the old precached shell: settled = no installing, no waiting worker left —
  // the found update is through installing and (skipWaiting) activating. Polled by hand
  // (see swReady).
  let settled = false;
  for (let i = 0; i < 75 && !settled; i++) {
    settled = await page.evaluate(() =>
      navigator.serviceWorker.getRegistration().then(
        (r) => !!r && !r.installing && !r.waiting,
      ),
    );
    if (!settled) await new Promise((r) => setTimeout(r, 200));
  }
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(url, { waitUntil: 'load' });
  await swReady(reopened);

  const chunkB = await loadedChunk(reopened);
  const reopenOk = chunkB !== null && chunkB !== chunkA;
  console.log(
    `reopen serves the second build ${JSON.stringify({ before: chunkA, after: chunkB })} → ` +
      `${reopenOk ? 'ok' : 'FAIL'}`,
  );
  if (!reopenOk) pass = false;
} finally {
  await browser.close();
  await new Promise((r) => previewServer.httpServer.close(r));
}

console.log(pass ? 'The press lands in a found update; the reopen serves it either way.' : 'FAIL.');
process.exit(pass ? 0 : 1);
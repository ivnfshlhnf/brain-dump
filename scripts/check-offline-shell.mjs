// The offline-shell check (host ticket 01): the decisive assertion the whole Host thread
// exists for — the built PWA cold-starts with the network gone, and a capture still
// enrolls Pending. The service-worker machinery has been configured since before it was
// ever active (it exists only in production builds, and the phone has only ever been
// served the dev server); this check makes "the shell paints offline" a test on the real
// artifact, not a hope about the next install.
//
//   node scripts/check-offline-shell.mjs [url]   — bare, it builds and serves dist/;
//                                                  pass a preview URL to reuse one
//
// Requires Node ≥ 20.19 (the engines field). Node 18 also defines the global `crypto`,
// but its workbox bundling still dies with "crypto is not defined" inside terser — so the
// honest gate is the version, not the feature. The repo pins 22 in .nvmrc.
import { chromium } from 'playwright';
import { ensureNode, seedStore } from './lib/check-harness.mjs';

ensureNode();

const { build, preview } = await import('vite');

// A dead port: the Vault read can go nowhere, like the phone after a redeploy of nothing.
const COUCH = 'http://127.0.0.1:5999';

const urlArg = process.argv.slice(2).find((a) => !a.startsWith('--'));

let previewServer = null;
let url = urlArg;
if (!url) {
  await build({ logLevel: 'error' });
  previewServer = await preview({ preview: { port: 0, host: '127.0.0.1' } });
  url = previewServer.resolvedUrls.local[0];
}

const browser = await chromium.launch();

let pass = true;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  await page.goto(url, { waitUntil: 'load' });
  await seedStore(page, {
    stores: ['settings'],
    settings: { couchdbUrl: COUCH, couchdbDb: 'obsidian' },
  });

  // The service worker must be active and controlling before the wire is cut — on a fresh
  // origin the first install finishes (precache done) only after activation, so "ready"
  // here means the shell is entirely in the cache. The first page load predates its
  // worker, so the reload below is also what hands the document to the SW's control.
  await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true), {
    timeout: 15000,
  });

  // The manual update action, against the built worker: the Settings sheet holds the
  // button (the Capture sheet does not — the masthead gear opens Settings, as in
  // shot-settings.mjs). A press with nothing newer at the Host must say so — asserting
  // the *outcome* line only, not a loose substring that the transient "Checking for
  // updates…" hint would satisfy before the decision lands.
  await page.click('.masthead__gear');
  await page.waitForSelector('text=Check for updates', { timeout: 5000 });
  await page.click('text=Check for updates');
  await page.waitForFunction(
    () => [...document.querySelectorAll('.hint')].some((el) => el.textContent.includes('This is the latest build.')),
    { timeout: 15000 },
  );
  console.log('update check on the built shell → ok');
  await page.click('.sheet__close');

  // The decisive cut: offline, reload. setOffline alone is not decisive — Chromium's
  // emulation does not reach service-worker fetches — so every request from here on is
  // also aborted at the route layer. A precached shell passes; anything that still
  // reaches for the network (a wrong workbox strategy, an unprecached asset) fails here.
  await context.setOffline(true);
  await context.route('**/*', (route) => route.abort());
  await page.reload({ waitUntil: 'load' });

  await page.waitForFunction(
    () =>
      navigator.serviceWorker.getRegistration().then((r) => r !== undefined && r.active !== null),
    { timeout: 5000 },
  );
  const shell = await page.evaluate(() => ({
    controlled: navigator.serviceWorker.controller !== null,
    captureReady: document.querySelector('.ctl-catch') !== null,
  }));
  const shellOk = shell.controlled && shell.captureReady;
  if (!shellOk) pass = false;
  console.log(`offline shell ${JSON.stringify(shell)} → ${shellOk ? 'ok' : 'FAIL'}`);

  // And the capture works: enroll Pending, exactly as configured offline.
  await page.click('.ctl-catch');
  await page.waitForSelector('.dump', { timeout: 5000 });
  await page.fill('.dump', 'caught while the Mac slept');
  await page.click('button.primary');

  // The receipt is the store, not the sheet: the Pending envelope reaches the outbox even
  // though the Vault is a dead host and the page has no network at all.
  const pending = await page.evaluate(
    () =>
      new Promise((res, rej) => {
        const db = indexedDB.open('brain-dump', 6);
        db.onsuccess = () => {
          const req = db.result.transaction(['outbox'], 'readonly').objectStore('outbox').getAll();
          req.onsuccess = () => res(req.result);
          req.onerror = () => rej(req.error);
        };
        db.onerror = () => rej(db.error);
      }),
  );
  const pendingOk =
    pending.length === 1 && pending[0].dump?.content === 'caught while the Mac slept';
  if (!pendingOk) pass = false;
  console.log(
    `offline capture → ${pending.length} record(s), content ${
      pending[0]?.dump?.content ? 'matches' : 'missing'
    } → ${pendingOk ? 'ok' : 'FAIL'}`,
  );

  await context.close();
} finally {
  await browser.close();
  if (previewServer) await previewServer.close();
}

if (!pass) {
  console.error('The built PWA must cold-start offline from its service worker, and a capture must still enroll Pending.');
  process.exit(1);
}
console.log('The offline shell paints, and a capture made in the dark enrolls Pending.');
// Recovery-refresh check: an offline capture must organize back into a Note when the
// connection returns — and the grid must SAY so while the session is still running. The
// engine half was never in doubt (recoverPending is pinned at the seam); the failure this
// guards came off the real Host on the phone (ticket 03): `onOnline` fires `recover()` and
// `enterGrid()` concurrently, so the grid read predates the recovery write, and recovery
// afterward touched only the Pending strip and a status line. The Note landed on the Vault
// (the phone's exported log proves it: "Note written, Dump no longer Pending") but the
// grid — the surface the user is looking at — never noticed until the next boot.
//
//   node scripts/check-recovery-refresh.mjs   — starts its own dev server
//
// The Vault is a canned same-origin mock on a path prefix (same origin → no CORS
// variables): an empty vault, PUTs that succeed, and one chat completion for the
// Organizer — which is the recovery path's only LLM call.
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

// The organizer's reply shape (src/lib/llm.ts parseOrganizeOutput).
const ORGANIZE = {
  title: 'Recovered Offline',
  tags: ['recovery'],
  category: 'uncategorized',
  summary: 'A capture filed in the dark, organized when the connection came back.',
  keyPoints: ['the connection returned'],
  related: [],
  body: 'Recovery check note.',
};

const COUCH = `${url}couch`; // `createRemoteDb` joins `couchdbUrl` + `/` + `couchdbDb`
const couchJson = (body) => ({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

// The mock Vault's memory: writes accumulate here, and every `allDocs` returns the whole
// store, so a re-read sees what was just written — a Vault that behaves like the real one.
const vaultDocs = new Map();

// The organizer's LLM endpoint rides in the settings record (same origin, path-prefixed:
// no CORS in play) — it is the recovery path's only LLM call.
const seed = {
  stores: ['settings'],
  settings: {
    couchdbUrl: COUCH,
    couchdbDb: 'obsidian',
    llmProvider: `${url}llm/v1`,
    llmApiKey: 'test-key',
  },
};

const browser = await chromium.launch();

let pass = true;

/** Wait for a selector, recording a verdict line instead of throwing past the report. */
async function waitOr({ onFail, page, selector, timeout = 30000 }) {
  try {
    await page.waitForSelector(selector, { timeout });
  } catch {
    onFail();
    console.log(`${selector} never appeared → FAIL`);
  }
}
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  // A Vault on a path prefix: PUTs land in `vaultDocs` and reads return the whole store,
  // so a grid re-read behaves like the real thing — recovery's write is visible to it.
  await page.route('**/couch/obsidian/**', (route) => {
    const method = route.request().method();
    const id = decodeURIComponent(route.request().url().split('/couch/obsidian/')[1].split('?')[0]);
    if (method === 'PUT') {
      vaultDocs.set(id, route.request().postDataJSON());
      return route.fulfill({ status: 201, body: JSON.stringify({ ok: true, id, rev: '1-check' }) });
    }
    if (id === '_all_docs') {
      const rows = [...vaultDocs.entries()].map(([id, doc]) => ({ id, doc, value: { rev: '1-check' } }));
      return route.fulfill(couchJson({ offset: 0, rows, total_rows: rows.length }));
    }
    const doc = vaultDocs.get(id);
    if (doc) return route.fulfill(couchJson({ _id: id, ...doc }));
    return route.fulfill({ status: 404, body: JSON.stringify({ error: 'not_found' }) });
  });
  await page.route('**/llm/v1/chat/completions', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'check', choices: [{ message: { role: 'assistant', content: JSON.stringify(ORGANIZE) } }] }),
    }),
  );

  await page.goto(url, { waitUntil: 'load' });
  await seedStore(page, seed);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.ctl-catch', { timeout: 5000 });

  // The wire goes down; capture anyway.
  await context.setOffline(true);
  await page.click('.ctl-catch');
  await page.waitForSelector('.dump', { timeout: 5000 });
  await page.fill('.dump', 'caught in the dark, filed when the light returns');
  await page.click('button.primary');
  await page.waitForSelector('.grid .card--pending', { timeout: 10000 });
  console.log('offline capture → Pending card in the grid → ok');

  // The connection returns. Recovery must organize the Dump into a Note — and the grid
  // must show the Note without a reload, which is the assertion the phone failed.
  await context.setOffline(false);
  await waitOr({ onFail: () => (pass = false), page, selector: 'text=Organized 1 Dump into a Note.' });
  const cardShown = await page
    .waitForSelector('.grid .card__title', { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  const grid = await page.evaluate(() => ({
    titles: [...document.querySelectorAll('.grid .card__title')].map((el) => el.textContent.trim()),
    pendingGone: document.querySelector('.card--pending') === null,
  }));
  const gridOk = cardShown && grid.titles.includes('Recovered Offline') && grid.pendingGone;
  if (!gridOk) pass = false;
  console.log(`after reconnect ${JSON.stringify(grid)} → ${gridOk ? 'ok' : 'FAIL'}`);

  await context.close();
} finally {
  await browser.close();
  if (server) await server.close();
}

if (!pass) {
  console.error('A recovered Dump must become a Note in the grid without a reload; recovery may write but the grid must hear about it.');
  process.exit(1);
}
console.log('Recovery files the Dump, and the running grid shows the Note it filed.');
// The sheet becomes the saved Note (capture-latency ticket 06): a successful save must
// keep the capture sheet open as the filed Note — a Filed stamp linking into the Vault,
// the Context field replaced by the frozen line, the countdown hint gone — and the user
// closes it, after which the next Capture opens blank. The failure this guards: the sheet
// tearing itself down at the moment the Note lands (the pre-ticket behaviour), which threw
// away the one thing worth showing and left filing without a visible end. This check sees
// the DOM and content only; the wet→dry cross-fade on the countdown edge is styling,
// verified by eye on the phone (ticket 06's hand test).
//
//   node scripts/check-committed-sheet.mjs   — starts its own dev server
//
// The Vault is a canned same-origin mock. Only the Organizer's chat completion is mocked:
// the Match and Related passes fail against it and degrade exactly as designed (a `new`
// decision, no links), so the autosave is what files the Note — the committed sheet must
// appear without anyone pressing Save now.
import { chromium } from 'playwright';
import { seedStore, fulfillChat } from './lib/check-harness.mjs';

const urlArg = process.argv.slice(2).find((a) => !a.startsWith('--'));

let server = null;
let url = urlArg;
if (!url) {
  const { createServer } = await import('vite');
  server = await createServer({ server: { port: 0 }, logLevel: 'error' });
  await server.listen();
  url = server.resolvedUrls.local[0];
}

// The organizer's reply shape (src/lib/llm.ts parseOrganizeOutput). Every chat completion
// answers with it — good enough for the Organizer, unparseable for the Matcher and the
// Relater, whose failures settle to `new` and `missed` respectively.
const ORGANIZE = {
  title: 'Committed Inline',
  tags: ['commit'],
  category: 'uncategorized',
  summary: 'A capture whose sheet stays open as the filed Note.',
  keyPoints: ['the sheet remains'],
  related: [],
  body: 'Committed-sheet check note.',
};

const COUCH = `${url}couch`;
const couchJson = (body) => ({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const vaultDocs = new Map();

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
  await page.route('**/llm/v1/chat/completions', (route) => fulfillChat(route, ORGANIZE));

  await page.goto(url, { waitUntil: 'load' });
  await seedStore(page, seed);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.ctl-catch', { timeout: 5000 });

  // Capture online: the preview opens, the match settles to `new` (its chat reply does not
  // parse), and the 5s autosave files the Note. Nothing is pressed after Capture.
  await page.click('.ctl-catch');
  await page.waitForSelector('.dump', { timeout: 5000 });
  await page.fill('.dump', 'the sheet should stay open when this lands');
  await page.click('button.primary');
  await waitOr({ onFail: () => (pass = false), page, selector: '.note' });

  // The write returns: the sheet commits in place rather than closing.
  await waitOr({ onFail: () => (pass = false), page, selector: '.note.committed', timeout: 20000 });
  const committed = await page.evaluate(() => ({
    filedStamp: !!document.querySelector('.note.committed .eyebrow .filed-mark'),
    vaultLink: document.querySelector('.note.committed .eyebrow a.vault-link')?.textContent ?? '',
    contextGone: document.querySelector('.context-field') === null,
    frozenLine: document.body.textContent.includes('The Dump is frozen'),
    doneButton: !!document.querySelector('.sheet__foot button.primary'),
    countdownHintGone: !document.body.textContent.includes('Saves 5 seconds after you stop typing'),
  }));
  const committedOk =
    committed.filedStamp &&
    committed.vaultLink.startsWith('Brain Dump/') &&
    committed.contextGone &&
    committed.frozenLine &&
    committed.doneButton &&
    committed.countdownHintGone;
  if (!committedOk) pass = false;
  console.log(`committed sheet ${JSON.stringify(committed)} → ${committedOk ? 'ok' : 'FAIL'}`);

  // The user closes it. The grid card is the receipt; the next Capture opens blank.
  await page.click('.sheet__foot button.primary');
  await page.waitForSelector('.sheet', { state: 'detached', timeout: 5000 });
  await page.click('.ctl-catch');
  const reopened = await page
    .waitForSelector('.dump', { timeout: 5000 })
    .then(async (el) => ({ present: true, value: await el.inputValue() }))
    .catch(() => ({ present: false, value: null }));
  const nextCaptureBlank = reopened.present && reopened.value === '';
  await page.keyboard.press('Escape');
  const card = await page.evaluate(
    () => document.querySelector('.grid .card__title')?.textContent.trim() ?? '',
  );
  const closeOk = nextCaptureBlank && card === 'Committed Inline';
  if (!closeOk) pass = false;
  console.log(`after close ${JSON.stringify({ reopened, card })} → ${closeOk ? 'ok' : 'FAIL'}`);

  await context.close();
} finally {
  await browser.close();
  if (server) await server.close();
}

if (!pass) {
  console.error('A successful save must leave the sheet open as the filed Note, and the user closes it.');
  process.exit(1);
}
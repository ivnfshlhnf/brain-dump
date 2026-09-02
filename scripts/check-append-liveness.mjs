// The save speaks while it files (capture-latency ticket 09).
// An Append confirm starts the longest wait a tap starts — merge, a wholesale re-organize
// (7s on the phone), the write — and for all of it the button sat exactly as it was: the
// phone log caught a save that looked dead long enough to be pressed again. This check
// drives the append path end to end — which no check had done: the first capture files
// itself (a real Note and Dump written by the app, not hand-built frontmatter), the second
// capture's Match answers `append`, and then:
//
//   - the Append button reads `Filing…` the moment it is pressed (liveness, ticket 07's
//     `Writing…` precedent, on the save),
//   - a second flush during the flight (Cmd+Enter — the button is disabled, so the keyboard
//     flush is the path a double press takes) is coalesced by the autosaver, as its
//     contract promises: the mock sees exactly one re-organize call,
//   - the sheet commits as the appended Note.
//
//   node scripts/check-append-liveness.mjs   — starts its own dev server
//
// Every chat reply is delayed ~1.5s so the flight is observable and the second flush
// provably lands inside it. Embeddings are left unrouted: the Related passes fail against
// the dev origin and degrade exactly as designed (a Note without links).
import { chromium } from 'playwright';
import { seedStore, fulfillChat, handleCouch } from './lib/check-harness.mjs';

const urlArg = process.argv.slice(2).find((a) => !a.startsWith('--'));

let server = null;
let url = urlArg;
if (!url) {
  const { createServer } = await import('vite');
  server = await createServer({ server: { port: 0 }, logLevel: 'error' });
  await server.listen();
  url = server.resolvedUrls.local[0];
}

const ORGANIZE = {
  title: 'Watering the basil',
  tags: ['basil'],
  category: 'uncategorized',
  summary: 'A reminder about the basil on the windowsill.',
  keyPoints: ['water the basil'],
  related: [],
  body: 'Water the basil on the windowsill.',
};
// The re-organized Note keeps the target's identity, so the title is how the check tells
// a wholesale re-organize of the merged Dump happened — and how many of them ran.
const MERGED = { ...ORGANIZE, title: 'Watering the basil (merged)' };

const MATCH_REPLY = { choices: [{ message: { role: 'assistant', content: '{"kind":"append","index":0}' } }] };
const jsonReply = (body) => ({
  status: 200,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const vaultDocs = new Map();
const seed = {
  stores: ['settings'],
  settings: {
    couchdbUrl: `${url}couch`,
    couchdbDb: 'obsidian',
    llmProvider: `${url}llm/v1`,
    llmApiKey: 'test-key',
  },
};

const browser = await chromium.launch();
let pass = true;
let reorganizeCalls = 0;

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  await page.route('**/couch/obsidian/**', (route) => handleCouch(route, vaultDocs));
  // The three chat callers answer by their prompt's first line (src/lib/llm.ts builders).
  // Every reply is delayed so the save flight outlives a double flush.
  await page.route('**/llm/v1/chat/completions', async (route) => {
    const body = route.request().postDataJSON();
    const prompt = body?.messages?.[0]?.content ?? '';
    await new Promise((r) => setTimeout(r, 1500));
    if (prompt.includes('You match a new brain-dump')) return route.fulfill(jsonReply(MATCH_REPLY));
    if (body?.stream !== true && prompt.includes('You organize a brain-dump')) {
      reorganizeCalls += 1;
      return route.fulfill(jsonReply({ id: 'check', choices: [{ message: { role: 'assistant', content: JSON.stringify(MERGED) } }] }));
    }
    return fulfillChat(route, ORGANIZE);
  });

  await page.goto(url, { waitUntil: 'load' });
  await seedStore(page, seed);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.ctl-catch', { timeout: 5000 });

  /** Poll by hand — `waitForFunction` never awaits a promise predicate (see memory). */
  async function until(fn, timeout = 30000) {
    const start = Date.now();
    for (;;) {
      const value = await fn();
      if (value) return value;
      if (Date.now() - start > timeout) return null;
      await page.waitForTimeout(100);
    }
  }
  const primaryButton = () =>
    page.evaluate(() => {
      const el = document.querySelector('.sheet__foot button.primary');
      return el ? { text: el.textContent.trim(), disabled: el.disabled } : null;
    });
  const anyButtonText = (needle) =>
    page.evaluate((n) => {
      const el = [...document.querySelectorAll('.sheet__foot button')].find((b) =>
        b.textContent.trim().startsWith(n),
      );
      return el ? el.textContent.trim() : null;
    }, needle);

  // Capture #1 files itself. The vault is empty, so the match settles `new` without a
  // suggestion — "Save now" founds the Note the second capture will append to.
  await page.click('.ctl-catch');
  await page.waitForSelector('.dump', { timeout: 5000 });
  await page.fill('.dump', 'water the basil on the windowsill');
  await page.click('button.primary');
  const saveNow = await until(() => anyButtonText('Save now'), 20000);
  if (!saveNow) {
    console.log('the preview never offered a save → FAIL');
    pass = false;
  }
  await page.click('.sheet__foot button.primary'); // Save now
  await page.waitForSelector('.note.committed', { timeout: 30000 });
  await page.click('.sheet__foot button.primary'); // Done
  await page.waitForSelector('.sheet', { state: 'detached', timeout: 5000 });

  // Capture #2: the Match mock answers `append` against the Note the first capture wrote.
  await page.click('.ctl-catch');
  await page.waitForSelector('.dump', { timeout: 5000 });
  await page.fill('.dump', 'the basil is looking droopy again');
  await page.click('button.primary');
  const appendButton = await until(async () => {
    const b = await primaryButton();
    return b && b.text.startsWith('Append') && !b.disabled ? b : null;
  }, 20000);
  if (!appendButton) {
    console.log('the Append button never appeared → FAIL');
    pass = false;
  } else {
    await page.click('.sheet__foot button.primary');

    // The tap landed: the button says so within the flight, and refuses a second flush.
    const filing = await until(async () => {
      const b = await primaryButton();
      return b && b.text.startsWith('Filing…') && b.disabled ? b : null;
    }, 3000);
    const livenessOk = !!filing;
    console.log(`save liveness ${JSON.stringify(await primaryButton())} → ${livenessOk ? 'ok' : 'FAIL'}`);
    if (!livenessOk) pass = false;

    // A second flush during the flight — the keyboard path, since the button is disabled.
    await page.click('.context-field textarea');
    await page.keyboard.press('Meta+Enter');
    await page.waitForSelector('.note.committed', { timeout: 30000 });
    const singleFlight = reorganizeCalls === 1;
    console.log(`re-organize calls after press + in-flight flush: ${reorganizeCalls} → ${singleFlight ? 'ok' : 'FAIL'}`);
    if (!singleFlight) pass = false;
  }

  await context.close();
} finally {
  await browser.close();
  if (server) await server.close();
}

if (!pass) {
  console.error('The save must say Filing… while it works, and one save must not run twice.');
  process.exit(1);
}
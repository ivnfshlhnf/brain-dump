import { chromium } from 'playwright';
const out = '/Users/ivanhanif/personal/shared-dev/brain-dump/.scratch/shots/pass-08';

const HEAD = `<header class="masthead"><span class="wordmark">brain-dump</span><nav>
<button class="on">capture</button><button>ask</button><button>config</button></nav></header>`;

const NOTE_BODY = `The outbox should retry on a timer as well as on the online event. A capture that fails while navigator.onLine is already true — a flaky connection, a captive portal, an LLM outage — never fires online, and the spec promises offline captures organize themselves without the user's intervention. Sixty seconds feels right; it is cheap and it is invisible.`;

// Related links are doors back into the Vault: each opens the real Note in Obsidian via
// obsidian://open?vault=…&file=… (vault name is per-device; slashes stay literal, segments
// encoded). The link text is the wikilink target without the brackets.
const VAULT = 'Personal';
const ob = (target) => `obsidian://open?vault=${encodeURIComponent(VAULT)}&file=${target.split('/').map(encodeURIComponent).join('/')}`;
const RELATED = `<ul class="links"><li><a class="vault-link" href="${ob('Offline capture and the outbox')}">Offline capture and the outbox</a></li><li><a class="vault-link" href="${ob('LiveSync CouchDB document format')}">LiveSync CouchDB document format</a></li><li><a class="vault-link" href="${ob('Things that fail silently')}">Things that fail silently</a></li></ul>`;

// The three truthful states of the Note card after the harden+bolder pass.
//   append — unconfirmed append: the edge is HELD (wet, full, not counting), because the
//            autosave no-ops until the user confirms. "Save now" is absent; Append and
//            Save as new Note are the save.
//   new    — a new Note, counting honestly: the ember edge burns down over 5s and a save
//            really will fire at the end.
//   saved  — committed: the edge has filled back and turned to dry ink, the Vault path
//            stands in the eyebrow, Related links are present.
const inner = (state) => {
  const committed = state === 'saved';
  const held = state === 'append';
  const burnClass = held ? 'burn burn--held' : 'burn';
  // The pending eyebrow is an uppercase machine marking, but the appended Note's title is a
  // person's words: the decision prefix uppercases, the title keeps its own case (keep-case).
  // When committed, the eyebrow becomes the filed line — "Filed to Obsidian" + the vault path
  // as an obsidian:// link (the door back into the Vault), in Dry Ink.
  const SAVED_PATH = 'brain-dump/Notes/Outbox retry on a timer.md';
  const eyebrow = committed
    ? `<span class="filed-mark">Filed to Obsidian</span><br><a class="vault-link" href="${ob(SAVED_PATH)}">${SAVED_PATH}</a>`
    : state === 'append'
      ? 'Append to <span class="keep-case">&ldquo;Offline capture and the outbox&rdquo;</span>'
      : 'New Note';
  const hint = committed
    ? 'Dump frozen. Your verbatim original is kept inside it.'
    : held
      ? 'Append waits for your confirmation — it won’t save on its own. Your verbatim original is kept.'
      : 'Saves 5 seconds after you stop typing. Your verbatim original is kept.';
  const appendActions = held
    ? `<div class="actions"><button class="primary">Append</button><button>Save as new Note</button></div>`
    : '';
  // "Save now" is honest only where a save will actually fire: new (counting) or saved
  // (disabled). On an unconfirmed append it is absent.
  const saveNow = held
    ? ''
    : `<button ${committed ? 'disabled' : ''}>Save now</button>`;
  const refresh = committed ? '<button>Refresh metadata</button>' : '';
  const status = committed
    ? '<p class="status">Saved Note: Outbox retry on a timer, not just on reconnect</p>'
    : '';
  const related = committed
    ? RELATED
    : '<p class="pending">Links are found when the Note is saved.</p>';

  return `
<article class="note${committed ? ' committed' : ''}">
  <div class="${burnClass}"></div>
  <p class="eyebrow">${eyebrow}</p>
  <h2>Outbox retry on a timer, not just on reconnect</h2>
  <dl class="meta">
    <dt>tags</dt><dd>#offline  #outbox  #reliability</dd>
    <dt>category</dt><dd>engineering</dd>
  </dl>
  <div class="note-body">${NOTE_BODY}</div>
  <p class="rule-label">summary</p>
  <p>Reconnect alone is not a sufficient trigger for draining the offline queue; a periodic retry covers the failure modes where the browser believes it is online.</p>
  <p class="rule-label">key points</p>
  <ul><li>The online event does not fire for captive portals or provider outages.</li><li>A 60s interval is armed only while the queue is non-empty.</li><li>The Dump is already safe in IndexedDB; the retry only affects when it is Organized.</li></ul>
  <p class="rule-label">related</p>
  ${related}
</article>
${appendActions}
<label class="context-field">add context<textarea ${committed ? 'disabled' : ''}></textarea></label>
<p class="hint">${hint}</p>
<div class="actions">${saveNow}${refresh}<button>New capture</button></div>
${status}
`;
};

const browser = await chromium.launch();
for (const scheme of ['light','dark']) {
  for (const vp of [{n:'desktop',w:1280,h:900},{n:'phone',w:390,h:844}]) {
    for (const state of ['append','new','saved']) {
      const ctx = await browser.newContext({ colorScheme: scheme, viewport:{width:vp.w,height:vp.h}, deviceScaleFactor: 2 });
      const page = await ctx.newPage();
      await page.goto('http://localhost:5173', { waitUntil:'load' });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(([head, body]) => {
        document.querySelector('main').innerHTML = head + body;
      }, [HEAD, inner(state)]);
      // Let the counting animation advance for the 'new' state so the screenshot shows
      // the burn partway down; the held and saved states are static.
      await page.waitForTimeout(state === 'new' ? 1800 : 400);
      await page.screenshot({ path: `${out}/${vp.n}-${scheme}-note-${state}.png`, fullPage: true });
      await ctx.close();
    }
  }
}
await browser.close();
console.log('done');
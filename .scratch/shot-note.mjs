import { chromium } from 'playwright';
const out = '/Users/ivanhanif/personal/shared-dev/brain-dump/.scratch/shots/critique-a';

const HEAD = `<header class="masthead"><span class="wordmark">brain-dump</span><nav>
<button class="on">capture</button><button>ask</button><button>config</button></nav></header>`;

const NOTE_BODY = `The outbox should retry on a timer as well as on the online event. A capture that fails while navigator.onLine is already true — a flaky connection, a captive portal, an LLM outage — never fires online, and the spec promises offline captures organize themselves without the user's intervention. Sixty seconds feels right; it is cheap and it is invisible.`;

const inner = (committed) => `
<article class="note${committed ? ' committed' : ''}">
  <div class="burn"></div>
  <p class="eyebrow">${committed ? 'brain-dump/Notes/Outbox retry on a timer.md' : 'append to “Offline capture and the outbox”'}</p>
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
  ${committed
    ? `<ul class="links"><li>[[Offline capture and the outbox]]</li><li>[[LiveSync CouchDB document format]]</li><li>[[Things that fail silently]]</li></ul>`
    : `<p class="pending">Links are found when the Note is saved.</p>`}
</article>
${committed ? '' : `<div class="actions"><button class="primary">Append</button><button>Save as new Note</button></div>`}
<label class="context-field">add context<textarea ${committed ? 'disabled' : ''}></textarea></label>
<p class="hint">${committed ? 'Dump frozen. Your verbatim original is kept inside it.' : 'Saves 5 seconds after you stop typing. Your verbatim original is kept.'}</p>
<div class="actions"><button ${committed ? 'disabled' : ''}>Save now</button>${committed ? '<button>Refresh metadata</button>' : ''}<button>New capture</button></div>
${committed ? '<p class="status">Saved Note: Outbox retry on a timer, not just on reconnect</p>' : ''}
`;

const browser = await chromium.launch();
for (const scheme of ['light','dark']) {
  for (const vp of [{n:'desktop',w:1280,h:900},{n:'phone',w:390,h:844}]) {
    for (const state of ['preview','saved']) {
      const ctx = await browser.newContext({ colorScheme: scheme, viewport:{width:vp.w,height:vp.h}, deviceScaleFactor: 2 });
      const page = await ctx.newPage();
      await page.goto('http://localhost:5173', { waitUntil:'load' });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(([head, body]) => {
        document.querySelector('main').innerHTML = head + body;
      }, [HEAD, inner(state === 'saved')]);
      await page.waitForTimeout(state === 'saved' ? 200 : 1400);
      await page.screenshot({ path: `${out}/${vp.n}-${scheme}-note-${state}.png`, fullPage: true });
      await ctx.close();
    }
  }
}
await browser.close();
console.log('done');

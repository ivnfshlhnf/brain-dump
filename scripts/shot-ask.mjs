// Screenshot the Ask sheet (ticket 07). The sheet is a native modal <dialog> opened with
// showModal(), reached from the grid's nav — so this script seeds the device-local card cache
// with a real NoteCard (so the grid paints a card and the Ask control is enabled, not dimmed for
// an empty Vault) and points CouchDB at a dead port (so the Vault read rejects and the cached
// card is kept). It then clicks the nav "ask" button — the app's own openAsk → showModal flow:
// the sheet's chrome, the modal behaviour and the focus handling are the app's, not a mock's.
//
// A real answer needs CouchDB + a live LLM + an embedder, none available here, so the answer and
// its citation cards are injected into the real, already-open sheet body the way
// scripts/shot-capture.mjs injects the review state — they render against the actual app.css
// rules. The behaviour behind it (retrieve/citedCards) is covered at Seam A by
// tests/retrieve.test.ts and tests/ask-sheet.test.ts; this is purely about how the sheet *looks*.
//
//   npm run dev
//   node scripts/shot-ask.mjs [url]
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const url = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:5176';
const outDir = resolve(process.cwd(), '.scratch/shots/ask');

// The Category hue the grid derives (ticket 04) — golden-angle from the member's index in the
// closed set — so a citation card wears the same hue its grid card does.
const CATEGORIES = ['troubleshooting', 'productivity', 'tools', 'coffee', 'personal'];
const hueFor = (category) =>
  category === 'uncategorized' ? null : (CATEGORIES.indexOf(category) * 137.5 + 30) % 360;

// NOTE: this mirrors the noteCard snippet in src/App.svelte (the grid card and the Ask sheet's
// citation card are the same markup). If the card structure in App.svelte changes, update this
// too, or the screenshot drifts silently from the real sheet.
function cardHtml(c) {
  const hue = hueFor(c.category);
  const cls = `card card--door${hue !== null ? ' card--cat' : ''}`;
  const style = hue !== null ? ` style="--cat-hue:${hue}"` : '';
  const tags = c.tags.slice(0, 3).map((t) => `<span class="card__tag">${t}</span>`).join('');
  const more = c.tags.length > 3 ? `<span class="card__tag-more">+${c.tags.length - 3} more</span>` : '';
  return `<article class="${cls}"${style} role="button" tabindex="0">
    <p class="card__category">${c.category}</p>
    <h3 class="card__title">${c.title}</h3>
    ${c.summary ? `<p class="card__summary">${c.summary}</p>` : ''}
    ${c.tags.length ? `<p class="card__tags">${tags}${more}</p>` : ''}
    <p class="card__date">${c.date}</p>
  </article>`;
}

// The synthesized answer plus the Notes it drew on, as the same cards the grid shows — so checking
// the answer against the user's own words is one tap into the Note sheet.
const ANSWER_BODY = `
  <section class="answer">
    <p>Water the basil twice a day while this heat lasts — once a day is not enough, and the plant on the windowsill has been telling you that all week.</p>
    <p class="rule-label">sources</p>
    <div class="grid">
      ${cardHtml({ title: 'Water the plants before the basil gives up', category: 'productivity', summary: 'A reminder to water the plants before the basil on the windowsill gives up entirely.', tags: ['home', 'plants', 'basil', 'summer'], date: '8/20/2026' })}
      ${cardHtml({ title: 'Grinder settings for the new beans', category: 'tools', summary: 'The new single-origin needs a finer grind than the old blend.', tags: ['coffee', 'grinder'], date: '8/18/2026' })}
    </div>
  </section>`;

const STATES = [
  { name: 'field', body: null }, // the real empty sheet — the question field, focused
  { name: 'answer', body: ANSWER_BODY }, // the synthesized answer with its citation cards
];

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'phone', width: 390, height: 844 },
];
const SCHEMES = ['light', 'dark'];

// Seed the card cache (so the grid paints a card and Ask is enabled) and point CouchDB at a dead
// port (so the Vault read rejects and the cached card is kept). Both persist across the reload.
const card = {
  path: 'Brain Dump/2026-08-20-water-the-plants.md',
  title: 'Water the plants before the basil gives up',
  category: 'productivity',
  summary: 'A reminder to water the plants before the basil gives up entirely.',
  tags: ['home', 'plants', 'basil'],
  createdAt: Date.UTC(2026, 7, 20, 20, 30, 45),
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
await mkdir(outDir, { recursive: true });

for (const scheme of SCHEMES) {
  for (const vp of VIEWPORTS) {
    for (const state of STATES) {
      const context = await browser.newContext({
        colorScheme: scheme,
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 2,
      });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await seedStore(page);
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('.card--door', { timeout: 5000 });
      await page.evaluate(() => document.fonts.ready);

      // The real thing: the nav's ask control opens the app's own sheet.
      await page.click('nav button:has-text("ask")');
      await page.waitForSelector('dialog.sheet:modal', { timeout: 5000 });
      await page.waitForTimeout(350); // the sheet rises over 280ms

      if (state.body) {
        // Inject the answer + citation cards after the Ask button, mirroring App.svelte.
        await page.evaluate((body) => {
          const sheetBody = document.querySelector('.sheet__body');
          sheetBody.insertAdjacentHTML('beforeend', body);
        }, state.body);
        await page.waitForTimeout(150);
      }

      const metrics = await page.evaluate(() => {
        const d = document.querySelector('dialog.sheet');
        const inner = document.querySelector('.sheet__inner');
        const answer = document.querySelector('.sheet__body .answer');
        const cards = document.querySelectorAll('.sheet__body .answer .card');
        return {
          modal: d?.matches(':modal') ?? false,
          coversViewport:
            Math.round(d.getBoundingClientRect().height) >= document.documentElement.clientHeight &&
            Math.round(d.getBoundingClientRect().width) >= document.documentElement.clientWidth,
          innerWidth: inner ? Math.round(inner.getBoundingClientRect().width) : null,
          answerPresent: answer !== null,
          citationCards: cards.length,
          // The field is the reason the sheet opened, so it takes focus — the way Capture does.
          focused: document.activeElement?.tagName === 'TEXTAREA' ? 'textarea' : document.activeElement?.className || null,
        };
      });

      const file = `${outDir}/${state.name}-${vp.name}-${scheme}.png`;
      await page.screenshot({ path: file });
      console.log(`${state.name}/${vp.name}/${scheme} → ${file}`, JSON.stringify(metrics));
      await context.close();
    }
  }
}

await browser.close();
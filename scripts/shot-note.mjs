// Screenshot the Note sheet (ticket 06). The card is a door: tapping it opens the whole Note
// at full length. The sheet is a native modal <dialog> opened with showModal(), and the only
// way the app sets `sheet = 'note'` is a card's click handler — so this script seeds the
// device-local card cache with a real NoteCard, reloads (the grid paints cached cards before the
// Vault read, ADR-0007), and clicks the card. That is the app's own openNote → showModal flow:
// the sheet's chrome, the modal behaviour and the focus handling are the app's, not a mock's.
//
// A real readNote needs CouchDB (the Vault), which is not available here, so the note's content
// is injected into the real, already-open sheet body the way scripts/shot-capture.mjs injects
// the review state — it renders against the actual app.css rules. The behaviour behind it
// (readNote/reorganizeNote/parseNote) is covered at Seam A by tests/note-sheet.test.ts; this is
// purely about how the sheet *looks*.
//
//   npm run dev
//   node scripts/shot-note.mjs [url]
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const url = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:5176';
const outDir = resolve(process.cwd(), '.scratch/shots/note');

// obsidian:// — the door back into the Vault. Mirrors src/lib/obsidian.ts so the injected path
// and Related links match the real hrefs the app produces (a fresh context has an empty vault
// name, so the link omits the vault).
function obsidianUrl(vault, file) {
  const v = vault.trim();
  const f = file.split('/').map(encodeURIComponent).join('/');
  return v ? `obsidian://open?vault=${encodeURIComponent(v)}&file=${f}` : `obsidian://open?file=${f}`;
}
function linkHref(vault, link) {
  return /^https?:\/\//i.test(link) ? link : obsidianUrl(vault, link.replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0].split('#')[0]);
}
function linkText(link) {
  return /^https?:\/\//i.test(link) ? link : link.replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0].split('#')[0];
}

const VAULT = '';
const PATH = 'Brain Dump/2026-08-21-water-the-plants.md';

// The single card the grid paints from the cache. Its path is what openNote reads; the read
// fails without CouchDB, so the sheet's body is injected below rather than read live.
const card = {
  path: PATH,
  title: 'Water the plants',
  category: 'personal',
  summary: 'A reminder to water the plants twice a day while the heat lasts.',
  tags: ['home', 'plants', 'basil'],
  createdAt: Date.UTC(2026, 7, 21, 20, 30, 45),
};

// NOTE: this mirrors the Note sheet markup in src/App.svelte (the `{:else if noteView}` branch).
// If that changes, change this too, or the screenshot drifts silently from the real sheet.
function noteHtml({ tags, body, summary, keyPoints, related, dump, context, category }) {
  const pathLink = `<a class="vault-link" href="${obsidianUrl(VAULT, PATH)}">${PATH}</a>`;
  const meta =
    (tags.length ? `<dt>tags</dt><dd>${tags.join('  ')}</dd>` : '') +
    (category && category !== 'uncategorized' ? `<dt>category</dt><dd>${category}</dd>` : '');
  const sections = [
    body ? `<div class="note-body">${body}</div>` : '',
    summary ? `<p class="rule-label">summary</p><p>${summary}</p>` : '',
    keyPoints.length
      ? `<p class="rule-label">key points</p><ul>${keyPoints.map((p) => `<li>${p}</li>`).join('')}</ul>`
      : '',
    `<p class="rule-label">related</p>` +
      (related.length
        ? `<ul class="links">${related.map((l) => `<li><a class="vault-link" href="${linkHref(VAULT, l)}">${linkText(l)}</a></li>`).join('')}</ul>`
        : `<p class="pending">No related documents.</p>`),
    dump
      ? `<p class="rule-label">your original</p><div class="verbatim">${dump}</div>` +
        (context ? `<p class="rule-label">context</p><div class="verbatim">${context}</div>` : '')
      : '',
  ];
  return `
    <article class="note committed">
      <p class="eyebrow"><span class="filed-mark">Filed</span><span class="eyebrow__sep" aria-hidden="true">·</span>${pathLink}</p>
      <h2>Water the plants</h2>
      <dl class="meta">${meta}</dl>
      ${sections.join('')}
    </article>`;
}

// The full Note, every field: title, all Tags, the body, summary, key points, Related links, and
// the verbatim source Dump with its Context — the room behind the door the card opened.
const FULL = {
  tags: ['home', 'plants', 'basil'],
  category: 'personal',
  body: 'I keep forgetting to water the plants, and the basil on the windowsill has been threatening to give up all week. It wants water twice a day in this heat, not once.',
  summary: 'A reminder to water the plants twice a day while the heat lasts.',
  keyPoints: ['Water the basil twice a day in the heat', 'Once a day is not enough in summer'],
  related: ['[[Brain Dump/2026-08-01-garden.md]]', '[[personal/garden]]'],
  dump: 'i keep forgetting to water the plants',
  context: 'added later',
};

// A tag-heavy Note: the card would truncate behind `+N more`, but the sheet shows every Tag,
// wrapping — the one thing the card hid that the sheet must not.
const TAGS = {
  tags: Array.from({ length: 10 }, (_, i) => `tag${i}`),
  category: 'personal',
  body: 'Ten tags, all shown, none hidden behind a count.',
  summary: '',
  keyPoints: [],
  related: [],
  dump: 'the raw words',
  context: '',
};

// The Note was deleted between the tap and the read: the grid reconciles it away on the next
// open; here it simply is gone. This mirrors App.svelte's `{:else}` branch, with no Re-organize
// (noteView is null).
const GONE_BODY = '<p class="pending">This Note is no longer in your Vault.</p>';

const STATES = [
  { name: 'full', body: noteHtml(FULL), foot: '<button>Re-organize</button>' },
  { name: 'tags', body: noteHtml(TAGS), foot: '<button>Re-organize</button>' },
  { name: 'gone', body: GONE_BODY, foot: '' },
];

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'phone', width: 390, height: 844 },
];
const SCHEMES = ['light', 'dark'];

// Seed the device-local card cache so the grid paints a real, clickable card, and point CouchDB
// at a dead port so the Vault read rejects fast — readGrid's warm-cache path then keeps the
// painted cached card (the catch returns `cards: cached`), instead of the empty-CouchDB read
// overwriting it. Both persist across the reload below.
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
      // Seed the cache + a dead CouchDB URL, then reload so enterGrid reads them and paints the
      // real card (the Vault read rejects against the dead port, so the cached card is kept).
      await seedStore(page);
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('.card--door', { timeout: 5000 });
      await page.evaluate(() => document.fonts.ready);

      // The real thing: the card's own click handler opens the app's own sheet.
      await page.click('.card--door');
      await page.waitForSelector('dialog.sheet:modal', { timeout: 5000 });
      await page.waitForTimeout(350); // the sheet rises over 280ms

      // Inject the note content into the real, open sheet body — mirroring App.svelte.
      await page.evaluate(
        ({ body, foot }) => {
          document.querySelector('.sheet__body').innerHTML = body;
          const actions = document.querySelector('.sheet__foot .actions');
          if (actions) actions.innerHTML = foot;
          // Clear any status the failed read left behind, so the injected state reads clean.
          const status = document.querySelector('.sheet__foot .status');
          if (status) status.remove();
        },
        { body: state.body, foot: state.foot },
      );
      await page.waitForTimeout(150);

      const metrics = await page.evaluate(() => {
        const d = document.querySelector('dialog.sheet');
        const inner = document.querySelector('.sheet__inner');
        const pathLink = document.querySelector('.eyebrow .vault-link');
        const tagsDd = document.querySelector('.meta dd');
        const verbatim = document.querySelector('.verbatim');
        return {
          modal: d?.matches(':modal') ?? false,
          coversViewport:
            Math.round(d.getBoundingClientRect().height) >= document.documentElement.clientHeight &&
            Math.round(d.getBoundingClientRect().width) >= document.documentElement.clientWidth,
          innerWidth: inner ? Math.round(inner.getBoundingClientRect().width) : null,
          // The path is an obsidian:// link — the door back into the Vault.
          pathIsObsidian: pathLink ? pathLink.getAttribute('href').startsWith('obsidian://open') : null,
          // Every Tag is shown — no `+N more` truncation in the sheet.
          tagsShown: tagsDd ? tagsDd.textContent.trim().split(/\s{2,}/).length : 0,
          verbatimPresent: verbatim !== null,
          buttons: [...document.querySelectorAll('.sheet__foot button')].map((b) => b.textContent.trim()),
          focused: document.activeElement?.className || null,
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
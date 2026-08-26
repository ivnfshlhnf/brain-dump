// Screenshot the grid view's card layout. The card markup below is injected straight into the
// real app's .grid after entering the grid view, so it renders against the actual app.css card
// rules — verifying layout (uniform height, 2-line clamp, tag overflow, columns) without
// needing a live CouchDB. The data flow itself (readGrid/cache) is covered by cards.test.ts;
// this is purely about how the cards *look*.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
const url = argv.find((a) => !a.startsWith('--')) ?? 'http://localhost:5176';
const empty = argv.includes('--empty');
const outDir = resolve(process.cwd(), empty ? '.scratch/shots/grid-empty' : '.scratch/shots/grid');

// Three Note cards that exercise the layout: a long summary (2-line clamp), tag overflow
// (5 tags → 3 + "+2 more"), an empty category (renders as —) and an empty summary.
const notes = [
  { title: 'Water the plants', category: 'home', summary: 'A reminder to water the plants before the basil on the windowsill gives up entirely, which it has been threatening to do all week.', tags: ['home', 'plants', 'basil', 'routine', 'summer'], date: '8/21/2026' },
  { title: 'Grinder settings for the new beans', category: 'coffee', summary: 'The new single-origin needs a finer grind than the old blend.', tags: ['coffee', 'grinder'], date: '8/18/2026' },
  { title: 'Why the adapter returns undefined', category: '', summary: '', tags: ['bug'], date: '8/15/2026' },
];

// A Pending Dump: captured, not yet a Note. Raw words in the mono voice, no actions.
const pending = [
  { words: 'kopi yang udah sebulan disimpen di freezer, masih bisa nggak ya', date: '8/22/2026' },
];

// A Stranded Dump: raw words, the reason it is stranded, and Retry + Dismiss.
const stranded = [
  { words: 'bayar pajak motor yang jatuh tempo bulan depan', reason: 'never became a Note', date: '8/20/2026' },
];

// NOTE: this markup mirrors the `.card` / `.card--open` structure in src/App.svelte so the
// screenshot exercises the real app.css card rules. If the card structure in App.svelte changes,
// update this to match or the screenshot will silently drift from the real grid.
function noteHtml(c) {
  const tags = c.tags.slice(0, 3).map((t) => `<span class="card__tag">${t}</span>`).join('');
  const more = c.tags.length > 3 ? `<span class="card__tag-more">+${c.tags.length - 3} more</span>` : '';
  return [
    '<article class="card">',
    `<p class="card__category">${c.category || '—'}</p>`,
    `<h3 class="card__title"><a class="vault-link" href="#">${c.title}</a></h3>`,
    c.summary ? `<p class="card__summary">${c.summary}</p>` : '',
    c.tags.length ? `<p class="card__tags">${tags}${more}</p>` : '',
    `<p class="card__date">${c.date}</p>`,
    '</article>',
  ].join('');
}

function pendingHtml(c) {
  return [
    '<article class="card card--open">',
    '<p class="card__category">Pending</p>',
    `<h3 class="card__title card__title--raw">${c.words}</h3>`,
    `<p class="card__date">${c.date}</p>`,
    '</article>',
  ].join('');
}

function strandedHtml(c) {
  return [
    '<article class="card card--open">',
    '<p class="card__category">Stranded</p>',
    `<h3 class="card__title card__title--raw">${c.words}</h3>`,
    `<p class="card__summary">${c.reason}</p>`,
    '<div class="card__actions">',
    '<button>Retry</button>',
    '<button>Dismiss</button>',
    '</div>',
    `<p class="card__date">${c.date}</p>`,
    '</article>',
  ].join('');
}

// The three bands in DOM order: Pending, Stranded, Notes — each its own `.grid`, so the open
// thoughts occupy their own row(s) pinned above the Note cards (acceptance #6).
function bandsHtml() {
  return [
    pending.length ? `<div class="grid">${pending.map(pendingHtml).join('')}</div>` : '',
    stranded.length ? `<div class="grid">${stranded.map(strandedHtml).join('')}</div>` : '',
    `<div class="grid">${notes.map(noteHtml).join('')}</div>`,
  ].join('');
}

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'phone', width: 390, height: 844 },
];
const SCHEMES = ['light', 'dark'];

const browser = await chromium.launch();
await mkdir(outDir, { recursive: true });

for (const scheme of SCHEMES) {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      colorScheme: scheme,
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.click('nav button:has-text("grid")');
    if (!empty) {
      await page.evaluate((html) => {
        // Replace the empty grid frame with the three bands (Pending, Stranded, Notes).
        const grid = document.querySelector('.grid-surface .grid');
        if (grid) grid.outerHTML = html;
      }, bandsHtml());
    }
    await page.waitForTimeout(150);
    const metrics = await page.evaluate(() => {
      const arts = [...document.querySelectorAll('.card')];
      const open = [...document.querySelectorAll('.card--open')];
      const grids = [...document.querySelectorAll('.grid')];
      return {
        vw: document.documentElement.clientWidth,
        cols: grids[0] ? getComputedStyle(grids[0]).gridTemplateColumns : null,
        bands: grids.length,
        openHeights: open.map((a) => Math.round(a.getBoundingClientRect().height)),
        noteHeights: arts.filter((a) => !a.classList.contains('card--open')).map((a) => Math.round(a.getBoundingClientRect().height)),
        tops: arts.map((a) => Math.round(a.getBoundingClientRect().top)),
      };
    });
    const file = `${outDir}/${vp.name}-${scheme}.png`;
    await page.screenshot({ path: file, fullPage: true });
    console.log(`${vp.name}/${scheme} → ${file}`, JSON.stringify(metrics));
    await context.close();
  }
}

await browser.close();

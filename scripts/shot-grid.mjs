// Screenshot the grid view's card layout. The card markup below is injected straight into the
// real app's .grid after entering the grid view, so it renders against the actual app.css card
// rules — verifying layout (uniform height, 2-line clamp, tag overflow, columns) without
// needing a live CouchDB. The data flow itself (listNotes/cache) is covered by cards.test.ts;
// this is purely about how the cards *look*.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
const url = argv.find((a) => !a.startsWith('--')) ?? 'http://localhost:5176';
const empty = argv.includes('--empty');
const outDir = resolve(process.cwd(), empty ? '.scratch/shots/grid-empty' : '.scratch/shots/grid');

// Three cards that exercise the layout: a long summary (2-line clamp), tag overflow
// (5 tags → 3 + "+2 more"), an empty category (renders as —) and an empty summary.
const cards = [
  { title: 'Water the plants', category: 'home', summary: 'A reminder to water the plants before the basil on the windowsill gives up entirely, which it has been threatening to do all week.', tags: ['home', 'plants', 'basil', 'routine', 'summer'], date: '8/21/2026' },
  { title: 'Grinder settings for the new beans', category: 'coffee', summary: 'The new single-origin needs a finer grind than the old blend.', tags: ['coffee', 'grinder'], date: '8/18/2026' },
  { title: 'Why the adapter returns undefined', category: '', summary: '', tags: ['bug'], date: '8/15/2026' },
];

// NOTE: this markup mirrors the `.card` structure in src/App.svelte so the screenshot exercises
// the real app.css card rules. If the card structure in App.svelte changes, update this to match
// or the screenshot will silently drift from the real grid.
function cardHtml(c) {
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
        const grid = document.querySelector('.grid-surface .grid');
        if (grid) grid.innerHTML = html;
      }, cards.map(cardHtml).join(''));
    }
    await page.waitForTimeout(150);
    const metrics = await page.evaluate(() => {
      const arts = [...document.querySelectorAll('.card')];
      const grid = document.querySelector('.grid');
      return {
        vw: document.documentElement.clientWidth,
        cols: grid ? getComputedStyle(grid).gridTemplateColumns : null,
        heights: arts.map((a) => Math.round(a.getBoundingClientRect().height)),
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

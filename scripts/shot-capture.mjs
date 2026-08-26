// Screenshot the Capture sheet (ticket 05). The empty state is the real thing — the script
// clicks the grid's Capture control and the app opens its own <dialog> — so the sheet's
// chrome, the field's height and the modal behaviour are the app's, not a mock's.
//
// The review state needs a Dump that has been through Organize, which needs CouchDB and a
// real LLM, so its markup is injected into the real sheet body the way scripts/shot-grid.mjs
// injects cards: it renders against the actual app.css rules. The behaviour behind it (the
// autosave contract Hold rests on, the projection a commit puts on the grid) is covered at
// Seam A by tests/autosave.test.ts and tests/cards.test.ts.
//
//   npm run dev
//   node scripts/shot-capture.mjs [url]
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const url = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:5176';
const outDir = resolve(process.cwd(), '.scratch/shots/capture');

// NOTE: this mirrors the review-state markup in src/App.svelte. If that changes, change this
// too, or the screenshot drifts silently from the real sheet.
function previewHtml({ append = false, held = false } = {}) {
  const burnHeld = held || append ? ' burn--held' : '';
  const eyebrow = append
    ? 'Append to <span class="keep-case">&ldquo;The plants&rdquo;</span>'
    : 'New Note';
  const hint = append
    ? 'Append waits for your confirmation — it won’t save on its own. Your verbatim original is kept.'
    : held
      ? 'Held — the countdown is stopped and won’t restart. It saves when you say so.'
      : 'Saves 5 seconds after you stop typing. Your verbatim original is kept.';
  return `
    <article class="note">
      <div class="burn${burnHeld}"></div>
      <p class="eyebrow">${eyebrow}</p>
      <h2>The basil is not going to make it</h2>
      <dl class="meta">
        <dt>tags</dt><dd>home  plants  basil</dd>
        <dt>category</dt><dd>personal</dd>
      </dl>
      <div class="note-body">I keep forgetting to water the plants, and the basil on the windowsill has been threatening to give up all week. It wants water twice a day in this heat, not once.</div>
      <p class="rule-label">summary</p>
      <p>A reminder to water the plants twice a day while the heat lasts.</p>
      <p class="rule-label">key points</p>
      <ul><li>Water the basil twice a day in the heat</li><li>Once a day is not enough in summer</li></ul>
      <p class="rule-label">related</p>
      <p class="pending">Links are found when the Note is saved.</p>
    </article>
    <label class="context-field">
      add context
      <textarea></textarea>
    </label>
    <p class="hint">${hint}</p>`;
}

function footHtml({ append = false, held = false } = {}) {
  if (append) {
    return '<button class="primary">Append</button><button>Save as new Note</button>';
  }
  return `<button class="primary">Save now</button>${held ? '' : '<button>Hold</button>'}`;
}

const STATES = [
  { name: 'field', preview: null },
  { name: 'preview', preview: {} },
  { name: 'held', preview: { held: true } },
  { name: 'append', preview: { append: true } },
];

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'phone', width: 390, height: 844 },
];
const SCHEMES = ['light', 'dark'];

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
      // The real thing: the grid's Capture control opens the app's own sheet.
      await page.click('.grid-controls .primary');
      await page.waitForTimeout(350); // the sheet rises over 280ms

      if (state.preview) {
        await page.evaluate(
          ({ body, foot }) => {
            document.querySelector('.sheet__body').innerHTML = body;
            document.querySelector('.sheet__foot .actions').innerHTML = foot;
            // The bar names the state too, and the app swaps it once a session opens.
            document.querySelector('.sheet__title').textContent = 'before it files';
          },
          { body: previewHtml(state.preview), foot: footHtml(state.preview) },
        );
        await page.waitForTimeout(150);
      }

      const metrics = await page.evaluate(() => {
        const d = document.querySelector('dialog.sheet');
        const burn = document.querySelector('.burn');
        const dump = document.querySelector('textarea.dump');
        const inner = document.querySelector('.sheet__inner');
        return {
          modal: d?.matches(':modal') ?? false,
          // The sheet takes the whole screen — that is what "full-screen" has to mean.
          coversViewport:
            Math.round(d.getBoundingClientRect().height) >= document.documentElement.clientHeight &&
            Math.round(d.getBoundingClientRect().width) >= document.documentElement.clientWidth,
          innerWidth: inner ? Math.round(inner.getBoundingClientRect().width) : null,
          // The countdown rides the preview card's top edge, and a held one does not run.
          burn: burn
            ? {
                top: Math.round(burn.getBoundingClientRect().top - burn.closest('.note').getBoundingClientRect().top),
                height: Math.round(burn.getBoundingClientRect().height),
                animation: getComputedStyle(burn).animationName,
              }
            : null,
          dumpFills: dump ? Math.round(dump.getBoundingClientRect().height) : null,
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

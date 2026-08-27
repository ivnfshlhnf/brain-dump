// Screenshot the Settings sheet (ticket 08). The fourth sheet, reached from the grid's masthead
// gear the way Capture and Ask are reached from the grid's control row (ticket 10). This script
// seeds the device-local card cache with a real NoteCard (so the grid paints a card) and the
// settings store with realistic field values (so the two fieldsets render filled, the way they
// would once the user has configured the app), and points CouchDB at a dead port (so the Vault
// read rejects and the cached card is kept). It then clicks the masthead gear — the app's own
// openSettings → showModal flow: the sheet's chrome, the modal behaviour and the focus handling
// are the app's, not a mock's.
//
// Real connection checks, reconcile results and diagnostics need a live CouchDB + LLM + embedder,
// none available here, so the `full` state injects the result blocks (connection checks, the
// Stranded list, the Dismissed list, diagnostics) into the real, already-open sheet body — they
// render against the actual app.css rules. The behaviour behind them is covered at Seam A by
// tests/health.test.ts, tests/pending.test.ts (including the new findDismissedDumps tests) and
// tests/operations.test.ts; this is purely about how the sheet *looks*.
//
//   npm run dev
//   node scripts/shot-settings.mjs [url]
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const url = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:5176';
const outDir = resolve(process.cwd(), '.scratch/shots/settings');

// Seed the card cache (so the grid paints a card) and the settings store (so the fieldsets render
// filled), and point CouchDB at a dead port (so the Vault read rejects and the cached card is
// kept). All persist across the reload.
const card = {
  path: 'Brain Dump/2026-08-21-water-the-plants.md',
  title: 'Water the plants before the basil gives up',
  category: 'productivity',
  summary: 'A reminder to water the plants before the basil gives up entirely.',
  tags: ['home', 'plants', 'basil'],
  createdAt: Date.UTC(2026, 7, 21, 20, 30, 45),
};
const seededSettings = {
  couchdbUrl: 'http://localhost:5984',
  couchdbDb: 'obsidiannotes',
  couchdbUser: 'van',
  couchdbPassword: 'hunter2hunter2',
  managedFolder: 'Brain Dump',
  dumpsFolder: '_dumps',
  vaultName: 'brain-dump',
  caseSensitive: false,
  llmProvider: 'https://openrouter.ai/api/v1',
  llmModel: 'deepseek/deepseek-v4-flash',
  llmApiKey: 'sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  embedderModel: 'openai/text-embedding-3-small',
  embeddingsDb: 'brain-dump-embeddings',
};
async function seedStore(page) {
  await page.evaluate(async ([card, settings]) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('brain-dump', 5);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction(['note-cards', 'settings'], 'readwrite');
      tx.objectStore('note-cards').put([card], 'all');
      tx.objectStore('settings').put(settings, 'current');
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, [card, seededSettings]);
}

// The result blocks the `full` state injects, mirroring App.svelte's Settings sheet markup. If the
// sheet's structure changes, update these too, or the screenshot drifts silently from the sheet.
const CHECKS = `
    <ul class="checks">
      <li>
        <svg class="check-mark" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" /></svg>
        <span><span class="sr-only">Passed:</span> <strong>CouchDB</strong> — reachable</span>
      </li>
      <li class="err">
        <svg class="check-mark" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5 11.5 11.5 M11.5 4.5 4.5 11.5" /></svg>
        <span><span class="sr-only">Failed:</span> <strong>Chat</strong> — needs attention: the API key was rejected</span>
      </li>
      <li>
        <svg class="check-mark" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" /></svg>
        <span><span class="sr-only">Passed:</span> <strong>Embeddings</strong> — reachable</span>
      </li>
    </ul>`;
const STRANDED = `
    <ul class="stranded">
      <li>
        <a class="vault-link stranded-when" href="#">8/21/2026, 8:30:45 PM</a>
        <span class="stranded-text">semekar adenium di grind 0.4 nyangkut banget<br /><span class="detail">never became a Note</span></span>
        <button>Organize</button>
        <button>Dismiss</button>
      </li>
      <li>
        <a class="vault-link stranded-when" href="#">8/20/2026, 9:15:00 PM</a>
        <span class="stranded-text">a second thought that also came to nothing<br /><span class="detail">its Note was deleted — Brain Dump/2026-08-20-note.md</span></span>
        <button>Restore</button>
        <button>Dismiss</button>
      </li>
    </ul>`;
const DISMISSED = `
    <ul class="stranded">
      <li>
        <a class="vault-link stranded-when" href="#">8/19/2026, 7:00:00 PM</a>
        <span class="stranded-text">an older thought I set aside<br /><span class="detail">never became a Note</span></span>
        <button>Restore</button>
      </li>
    </ul>`;
const DIAGNOSTICS = `
        <li><code>8:30:45 PM</code> <strong>capture</strong> Dump filed <code class="detail">{"path":"Brain Dump/2026-08-21-water.md"}</code></li>
        <li class="err"><code>8:31:02 PM</code> <strong>config</strong> settings rejected <code class="detail">{"problem":"bad-url"}</code></li>
        <li><code>8:31:10 PM</code> <strong>reconcile</strong> Vault reconciled <code class="detail">{"stranded":2}</code></li>`;

const STATES = [
  { name: 'form', inject: null }, // the real empty sheet — fieldsets filled, no results yet
  { name: 'full', inject: 'on' }, // connection checks + Stranded + Dismissed + diagnostics injected
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
      await seedStore(page);
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('.card--door', { timeout: 5000 });
      await page.evaluate(() => document.fonts.ready);

      // The real thing: the masthead's settings gear opens the app's own sheet (ticket 10).
      await page.click('.masthead__gear');
      await page.waitForSelector('dialog.sheet:modal', { timeout: 5000 });
      await page.waitForTimeout(350); // the sheet rises over 280ms

      if (state.inject) {
        // Inject the result blocks after their action buttons, mirroring App.svelte. The
        // connection/stranded/dismissed result lists are conditionally rendered on data the
        // headless run cannot produce; the diagnostics list always exists (empty) and is filled.
        await page.evaluate(([checks, stranded, dismissed, diagnostics]) => {
          const body = document.querySelector('.sheet__body');
          const after = (label, html) => {
            const btn = [...body.querySelectorAll('button')].find(
              (b) => b.textContent.trim() === label,
            );
            if (btn) btn.closest('.actions').insertAdjacentHTML('afterend', html);
          };
          after('Test connection', checks);
          after('Find stranded Dumps', stranded);
          after('Show dismissed Dumps', dismissed);
          const diag = body.querySelector('.diagnostics');
          if (diag) diag.innerHTML = diagnostics;
        }, [CHECKS, STRANDED, DISMISSED, DIAGNOSTICS]);
        await page.waitForTimeout(150);
      }

      const metrics = await page.evaluate(() => {
        const d = document.querySelector('dialog.sheet');
        const inner = document.querySelector('.sheet__inner');
        return {
          modal: d?.matches(':modal') ?? false,
          coversViewport:
            Math.round(d.getBoundingClientRect().height) >= document.documentElement.clientHeight &&
            Math.round(d.getBoundingClientRect().width) >= document.documentElement.clientWidth,
          innerWidth: inner ? Math.round(inner.getBoundingClientRect().width) : null,
          fieldsets: document.querySelectorAll('.sheet__body .field-group').length,
          saveButton: !![...document.querySelectorAll('.sheet__body button')].find(
            (b) => b.textContent.trim() === 'Save settings',
          ),
          checks: document.querySelectorAll('.sheet__body .checks li').length,
          stranded: document.querySelectorAll('.sheet__body .stranded li').length,
          diagnostics: document.querySelectorAll('.sheet__body .diagnostics li').length,
          // A reading/form sheet: focus lands on the way out, the way a modal conventionally does.
          focused: document.activeElement?.className || null,
        };
      });

      // The Settings form is taller than the viewport and `.sheet__body` scrolls, so a viewport
      // screenshot catches only the fieldsets. For the capture only, relax the scroll containment so
      // the dialog lays out at its full content height, then screenshot the whole `dialog.sheet`
      // element — Playwright captures the element's full box even when it overflows the viewport.
      // The real sheet's modal coverage is already asserted in `metrics.coversViewport` above.
      await page.locator('.sheet__close').focus(); // so the close control's ring shows in the capture
      await page.addStyleTag({
        content: `
        dialog.sheet { position: absolute !important; inset: auto !important; top: 0; left: 0; width: 100% !important; height: auto !important; max-height: none !important; overflow: visible !important; animation: none !important; }
        .sheet__inner { height: auto !important; max-height: none !important; }
        .sheet__body { overflow: visible !important; max-height: none !important; height: auto !important; }
        `,
      });
      await page.waitForTimeout(120);

      const file = `${outDir}/${state.name}-${vp.name}-${scheme}.png`;
      await page.locator('dialog.sheet').screenshot({ path: file });
      console.log(`${state.name}/${vp.name}/${scheme} → ${file}`, JSON.stringify(metrics));
      await context.close();
    }
  }
}

await browser.close();
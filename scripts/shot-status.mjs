// Screenshot the status strip (ticket 09) — the grid's one cross-cutting voice. The strip is
// grid-only and never renders inside a sheet, so each capture closes any open sheet first and
// asserts no `<dialog class="sheet">` is modal, then screenshots the `.status-strip` element.
//
// The strip carries three (four, counting both directions of connection) kinds, each driven
// through the app's own flow:
//   - connection-lost / connection-restored: the app listens for browser `online`/`offline`
//     events and calls the operation-layer `connectionTransition`; we dispatch those events
//     (the handler tracks `wasOnline` itself, so no network emulation is needed for these two).
//   - capture-confirmed: a real offline capture. `context.setOffline(true)` makes
//     `navigator.onLine` false, so `captureThought` takes the offline path and emits
//     `capture-confirmed` via `onStatus` — the app's own nav → Capture sheet → capture flow.
//   - config-rejected: open Settings, blank the LLM provider, Save — `validateProviderUrl`
//     rejects and `saveConfig` sets the strip — then close the sheet so the grid strip shows.
//
// The behaviour behind each kind is covered at Seam A by tests/status.test.ts and
// tests/pending.test.ts; this is purely about how the strip *looks*.
//
//   npm run dev
//   node scripts/shot-status.mjs [url]
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const url = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:5176';
const outDir = resolve(process.cwd(), '.scratch/shots/status');

// Seed the card cache (so the grid paints a card — the strip's home surface) and the settings
// store (so Save has something to reject), and point CouchDB at a dead port (so the Vault read
// rejects and the cached card is kept). All persist across the reload.
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

// Each state is a function that, given a page already on the grid with the card seeded, drives
// the app to the strip kind and resolves once the strip text is visible.
const STATES = [
  {
    name: 'connection-lost',
    drive: async (page) => {
      await page.evaluate(() => window.dispatchEvent(new Event('offline')));
      await page.waitForSelector('.status-strip__text:text("offline")', { timeout: 5000 });
    },
  },
  {
    name: 'connection-restored',
    drive: async (page) => {
      // Go lost first, then come back — the restored message resolves the lost one.
      await page.evaluate(() => window.dispatchEvent(new Event('offline')));
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await page.waitForSelector('.status-strip__text:text("back online")', { timeout: 5000 });
    },
  },
  {
    name: 'capture-confirmed',
    drive: async (page, context) => {
      // A real offline capture: navigator.onLine false → captureThought's offline path emits
      // capture-confirmed via onStatus, and the Capture sheet closes back to the grid.
      await context.setOffline(true);
      await page.waitForFunction(() => !navigator.onLine);
      await page.click('.grid-controls button:has-text("Capture")');
      await page.waitForSelector('dialog.sheet:modal', { timeout: 5000 });
      await page.fill('textarea', 'a thought captured while offline');
      await page.click('dialog.sheet button:has-text("Capture")');
      await page.waitForSelector('.status-strip__text:text("Captured")', { timeout: 8000 });
      // NB: do NOT setOffline(false) here — going back online fires `online`, whose handler
      // would set a "back online" strip and clobber the capture-confirmed we just captured.
      // Each state runs in its own context (closed below), so leaving it offline is harmless.
    },
  },
  {
    name: 'config-rejected',
    drive: async (page) => {
      await page.click('.masthead__gear');
      await page.waitForSelector('dialog.sheet:modal', { timeout: 5000 });
      // Blank the LLM provider — validateProviderUrl rejects a blank value.
      // Settings inputs have no id; target by their label text.
      await page.locator('label:has-text("LLM provider") input').fill('');
      await page.click('dialog.sheet button:has-text("Save settings")');
      // The rejection lands first on the sheet's own local status foot (the grid strip is
      // hidden while any sheet is open). Wait for that, then close so the grid strip shows.
      await page.waitForSelector('dialog.sheet p.status:text("LLM provider")', { timeout: 5000 });
      await page.click('dialog.sheet .sheet__close');
      await page.waitForFunction(() => !document.querySelector('dialog.sheet:modal'));
      await page.waitForSelector('.status-strip__text:text("LLM provider")', { timeout: 5000 });
    },
  },
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
        // Start online; the capture-confirmed state takes itself offline.
        offline: false,
      });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await seedStore(page);
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('.card--door', { timeout: 5000 });
      await page.evaluate(() => document.fonts.ready);

      await state.drive(page, context);
      await page.waitForTimeout(200); // let the strip settle

      // Assert the strip is on the grid, not inside a sheet, and carries a word + a dismiss.
      const metrics = await page.evaluate(() => {
        const strip = document.querySelector('.status-strip');
        return {
          strip: !!strip,
          sheetOpen: !!document.querySelector('dialog.sheet:modal'),
          text: strip?.querySelector('.status-strip__text')?.textContent?.trim() ?? null,
          dismiss: !!strip?.querySelector('.status-strip__dismiss'),
          alert: strip?.classList.contains('status-strip--alert') ?? false,
        };
      });

      // The viewport, not the element (AGENTS.md § View verification). This shot used to be
      // `locator('.status-strip').screenshot()`, which is how the strip shipped with no border
      // and no background — an element with no chrome photographs exactly like one with correct
      // chrome — and sitting below the whole card grid, which an element-scoped shot cannot show
      // at all. Where the strip sits relative to the controls and the grid is the point.
      const file = `${outDir}/${state.name}-${vp.name}-${scheme}.png`;
      await page.screenshot({ path: file });
      console.log(`${state.name}/${vp.name}/${scheme} → ${file}`, JSON.stringify(metrics));
      await context.close();
    }
  }
}

await browser.close();
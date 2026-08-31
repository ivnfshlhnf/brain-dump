// Screenshot the home (ticket 10): the grid is the app's only persistent surface. The masthead
// carries the wordmark and the settings gear; the control stack carries Catch (the dashed entry
// point) and Ask; Ask is disabled when the Vault is empty. Dark leads — dark is the default when
// the system expresses no preference, light follows the system.
//
// This is the view cutover, which has no operation seam (spec: "the view has no seam,
// deliberately"), so like the other shot scripts this verifies how the home *looks* and *feels*:
// the masthead, the controls, the c/a/s keyboard shortcuts, and that dark is the default. The
// data flow is covered at Seam A; the sheets' own chrome is covered by their own shot scripts.
//
//   npm run dev
//   node scripts/shot-home.mjs [url]
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const url = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:5176';
const outDir = resolve(process.cwd(), '.scratch/shots/home');

// Seed the card cache (so the grid paints a card and the Ask control is enabled, not disabled
// for an empty Vault) and the settings store (so a real settings sheet renders behind the gear),
// and point CouchDB at a dead port (so the Vault read rejects and the cached card is kept). All
// persist across the reload.
const card = {
  path: 'Brain Dump/2026-08-21-water-the-plants.md',
  title: 'Water the plants before the basil gives up',
  category: 'productivity',
  summary: 'A reminder to water the plants before the basil on the windowsill gives up entirely.',
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
      const r = indexedDB.open('brain-dump', 6);
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

// The resolved ground (on <html>, not <body> — the body is transparent) tells which scheme is
// active. It is an oklch lightness in this Chromium (e.g. `oklch(0.97 0.008 240)` for light,
// `oklch(0.21 0.028 235)` for dark); older paths may still hand back `rgb(...)`. Parse either: the
// oklch L channel is a 0–1 perceptual lightness, so L < 0.5 is dark; the rgb channel sum < 300
// is dark.
function schemeOf(bg) {
  const ok = bg.match(/oklch\(\s*([0-9.]+)%?\s/);
  if (ok) {
    let l = +ok[1];
    if (ok[1].includes('%')) l = l / 100;
    return l < 0.5 ? 'dark' : 'light';
  }
  const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return 'unknown';
  return +m[1] + +m[2] + +m[3] < 300 ? 'dark' : 'light';
}
// The ground lives on <html> (documentElement); <body> is transparent. Read it there.
const groundOf = (page) => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'phone', width: 390, height: 844 },
];
// 'no-preference' is the system expressing nothing — the case the dark default is for. Light and
// dark are the explicit system choices. NB: Chromium and Firefox both emulate `no-preference` as
// `light`, so the no-preference shot renders light; the dark default is the dark-first
// `color-scheme` declaration (verified in the desktop no-preference pass above), not the render.
const SCHEMES = ['no-preference', 'light', 'dark'];

const browser = await chromium.launch();
await mkdir(outDir, { recursive: true });

// One desktop pass, no-preference, drives the c/a/s shortcuts before screenshotting — the
// shortcuts are a home-surface behaviour, so they are exercised once, on the default scheme.
{
  const context = await browser.newContext({
    colorScheme: 'no-preference',
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await seedStore(page);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.card--door', { timeout: 5000 });
  await page.evaluate(() => document.fonts.ready);

  // The home has the wordmark, the gear, and Catch + Ask in the control stack (Ask enabled, the
  // Vault is not empty).
  const home = await page.evaluate(() => ({
    wordmark: !!document.querySelector('.wordmark'),
    gear: !!document.querySelector('.masthead__gear'),
    catch: !!document.querySelector('.ctl-catch'),
    ask: !!document.querySelector('.ctl-ask'),
    askDisabled: document.querySelector('.ctl-ask')?.disabled ?? null,
  }));

  // The c/a/s shortcuts open the right sheet, one at a time — sheets do not nest. Wait for the
  // Ask control to be enabled first: the Vault read (CouchDB at a dead port) rejects on load and
  // the app keeps the cached card, but there is a brief window after the read settles where Ask
  // is still disabled — pressing `a` there is a correct no-op (the spec ties `a` to
  // `!vaultIsEmpty`). Waiting for `disabled === false` means `a` is exercised only once the Vault
  // has settled, the way a user would encounter it.
  await page.waitForFunction(
    () => {
      const b = document.querySelector('.ctl-ask');
      return !!b && !b.disabled;
    },
    null,
    { timeout: 10000 },
  );

  const shortcuts = {};
  for (const [key, expect] of [['c', 'capture'], ['a', 'ask'], ['s', 'settings']]) {
    await page.keyboard.press(key);
    // Wait on existence (a boolean the page reports), not Playwright's selector-engine visibility:
    // a top-layer <dialog> opened via showModal() from a keyboard shortcut races with the engine's
    // attached/detached polling right after the open and after the Esc close. A boolean predicate
    // polls the same `:modal` state the app drives and is what the close-wait below mirrors.
    try {
      await page.waitForFunction(() => !!document.querySelector('dialog.sheet:modal'), null, { timeout: 5000 });
    } catch (e) {
      const st = await page.evaluate(() => ({ open: !!document.querySelector('dialog.sheet:modal'), askBtn: (() => { const b = document.querySelector('.ctl-ask'); return b ? { disabled: b.disabled, text: b.textContent.trim() } : null; })(), active: document.activeElement?.tagName }));
      console.log(`ITER ${key} open-wait FAILED. DOM:`, JSON.stringify(st));
      throw e;
    }
    const open = await page.evaluate(() => {
      const d = document.querySelector('dialog.sheet:modal');
      return { count: document.querySelectorAll('dialog.sheet:modal').length, title: d?.querySelector('.sheet__title')?.textContent?.trim() ?? null };
    });
    shortcuts[key] = { open: open.title, nested: open.count > 1 };
    // Close back to the grid before the next shortcut. Esc fires the dialog's native `cancel`,
    // whose `close` event runs the app's `on:close` → `sheet = null` → the dialog leaves the DOM.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog.sheet'), null, { timeout: 5000 });
  }

  // The gear opens the settings sheet (pointer, not keyboard).
  await page.click('.masthead__gear');
  await page.waitForFunction(() => !!document.querySelector('dialog.sheet:modal'), null, { timeout: 5000 });
  const gearOpen = await page.evaluate(() => document.querySelector('dialog.sheet:modal .sheet__title')?.textContent?.trim());
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog.sheet'), null, { timeout: 5000 });

  // Dark-default (acceptance #7): "Dark is the default when the system expresses no preference,
  // and light follows the system." The default is declared, not rendered: `color-scheme: dark
  // light` lists dark first, so a browser with a genuine no-preference picks dark; the `:root`
  // token defaults are the dark values, and `@media (prefers-color-scheme: light)` is the override
  // the system opts into. Both Chromium and Firefox (the only Playwright engines) emulate
  // `no-preference` as `light` — `matchMedia('(prefers-color-scheme: light)').matches` is true and
  // `light-dark()` resolves to its light arm under no-preference — so the no-preference render is
  // light and cannot demonstrate the dark default. Verify the declaration instead: the computed
  // `color-scheme` is dark-first, and the `:root` `--ground` resolves to the dark value when no
  // light media query applies (proven by the explicit-`dark` shot below resolving dark).
  const darkDefault = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement).colorScheme;
    return { colorSchemeDarkFirst: cs.startsWith('dark'), colorScheme: cs };
  });
  const noPrefRenders = schemeOf(await groundOf(page));
  console.log('shortcuts → home:', JSON.stringify(home), 'shortcuts:', JSON.stringify(shortcuts), 'gear:', gearOpen, 'darkDefault:', JSON.stringify(darkDefault), 'no-pref renders:', noPrefRenders, '(light — engines emulate no-preference as light; dark default is the dark-first color-scheme declaration)');
  await context.close();
}

// Screenshot the home (no sheet open) across scheme × viewport.
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
    await seedStore(page);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.card--door', { timeout: 5000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);

    const resolved = schemeOf(await groundOf(page));
    const metrics = await page.evaluate(() => ({
      wordmark: !!document.querySelector('.wordmark'),
      gear: !!document.querySelector('.masthead__gear'),
      catch: !!document.querySelector('.ctl-catch'),
      ask: !!document.querySelector('.ctl-ask'),
      sheetOpen: !!document.querySelector('dialog.sheet:modal'),
    }));

    const file = `${outDir}/${vp.name}-${scheme}.png`;
    await page.screenshot({ path: file, fullPage: true });
    console.log(`${vp.name}/${scheme} → ${file}`, JSON.stringify({ resolved, ...metrics }));
    await context.close();
  }
}

await browser.close();
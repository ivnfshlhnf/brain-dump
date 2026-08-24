// Pass 03 — the capture surface, shown as it actually behaves on load.
//
// The optimize pass made three things true at first paint: the Dump is autofocused (the
// focus ring lands on it, so the first character needs no tap), a thought interrupted by
// a closed tab is restored from localStorage (the field is not empty), and the committing
// control is a 44px touch target. This seeds a draft, loads, and screenshots — in both
// schemes at both widths, because light-dark() means a thing can read right in one and
// wrong in the other.
//
//   npm run dev   # in one shell
//   node .scratch/shot-capture.mjs
//
// Output → .scratch/shots/pass-08/ (gitignored — never commit screenshots of a real vault).
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const url = 'http://localhost:5173';
const out = resolve(process.cwd(), '.scratch/shots/pass-09');
const DRAFT = 'A thought I must not lose mid-sentence. The outbox should retry on a timer, not just on reconnect.';

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'phone', width: 390, height: 844 },
];
const SCHEMES = ['light', 'dark'];

const browser = await chromium.launch();
await mkdir(out, { recursive: true });

for (const scheme of SCHEMES) {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      colorScheme: scheme,
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    // Seed the draft before the app loads, so the first paint shows the restored thought
    // rather than an empty field.
    await page.addInitScript(([key, val]) => {
      try { localStorage.setItem(key, val); } catch {}
    }, ['brain-dump:dump-draft', DRAFT]);
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    // Let the autofocus settle and the focus ring paint.
    await page.waitForTimeout(250);

    const file = `${out}/${vp.name}-${scheme}-capture.png`;
    await page.screenshot({ path: file, fullPage: true });
    console.log(`${vp.name}/${scheme} → ${file}`);
    await ctx.close();
  }
}

await browser.close();
console.log('done');
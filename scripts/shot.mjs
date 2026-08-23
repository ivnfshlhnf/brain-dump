// Screenshot the running app, so design work can be looked at instead of imagined.
//
// The agent working on this repo cannot see the app. Every visual decision before this
// script existed was made blind, verified only through computed styles, and checked by
// asking the user to look. This closes that loop: one command produces the app in both
// colour schemes at both a phone and a desktop width.
//
//   npm run dev                       # in one shell
//   node scripts/shot.mjs             # in another
//   node scripts/shot.mjs --url http://localhost:5174 --out .scratch/shots
//
// Output is written to .scratch/shots/ by default, which is gitignored — screenshots of a
// real vault are not something to commit.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const url = arg('url', 'http://localhost:5173');
const outDir = resolve(process.cwd(), arg('out', '.scratch/shots'));

// Both schemes, because every colour resolves through light-dark() and a change can look
// right in one and wrong in the other. Both widths, because the layout is a single column
// that has to hold at 390px and not look stranded at 1280.
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
    // Self-hosted webfonts arrive after load; screenshotting before they do captures the
    // fallback stack and quietly misrepresents every typographic decision.
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);

    const file = `${outDir}/${vp.name}-${scheme}.png`;
    await page.screenshot({ path: file, fullPage: true });
    console.log(`${vp.name}/${scheme} → ${file}`);
    await context.close();
  }
}

await browser.close();

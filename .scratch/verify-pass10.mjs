// Polish pass (10) verification: the things a screenshot cannot state — whether the fields
// actually grow, whether focus still reaches everything in order, and what the recomputed
// colours resolve to in sRGB so contrast is a number rather than an impression.
import { chromium } from 'playwright';

const url = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:5173';
const browser = await chromium.launch();

for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);

  // Does the Dump actually grow with the thought, and stop at the ceiling?
  const grow = { empty: await page.evaluate(() => Math.round(document.querySelector('textarea.dump').getBoundingClientRect().height)) };
  await page.fill('textarea.dump', Array.from({ length: 12 }, (_, i) => `line ${i + 1} of a thought that keeps going`).join('\n'));
  await page.waitForTimeout(120);
  grow.twelveLines = await page.evaluate(() => Math.round(document.querySelector('textarea.dump').getBoundingClientRect().height));
  await page.fill('textarea.dump', Array.from({ length: 80 }, (_, i) => `line ${i + 1}`).join('\n'));
  await page.waitForTimeout(120);
  grow.eightyLines = await page.evaluate(() => Math.round(document.querySelector('textarea.dump').getBoundingClientRect().height));
  grow.ceiling60vh = Math.round(900 * 0.6);
  await page.fill('textarea.dump', '');

  // Keyboard: tab order through the masthead into the surface, and a visible ring on each stop.
  const tabOrder = [];
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab');
    tabOrder.push(await page.evaluate(() => {
      const a = document.activeElement;
      const ring = getComputedStyle(a).outlineWidth;
      return `${a.tagName.toLowerCase()}:${(a.getAttribute('aria-label') ?? a.textContent ?? '').trim().slice(0, 22)}|ring=${ring}`;
    }));
  }

  // Resolved colours, forced into sRGB (getComputedStyle hands back the oklch string
  // unconverted, and canvas fillStyle rejects oklch outright).
  const colors = await page.evaluate(() => {
    const probe = document.createElement('div');
    document.body.append(probe);
    const srgb = (value) => {
      probe.style.backgroundColor = `color-mix(in srgb, ${value} 100%, transparent 0%)`;
      const m = getComputedStyle(probe).backgroundColor.match(/[\d.]+/g);
      return m.slice(0, 3).map(Number);
    };
    const root = getComputedStyle(document.documentElement);
    const tok = (n) => root.getPropertyValue(n).trim();
    const out = {
      disabledPrimaryFill: srgb(`color-mix(in oklab, ${tok('--ember')}, ${tok('--dim')} 45%)`),
      ground: srgb(tok('--ground')),
      raised: srgb(tok('--raised')),
      dim: srgb(tok('--dim')),
      ember: srgb(tok('--ember')),
    };
    probe.remove();
    return out;
  });

  const lum = ([r, g, b]) => {
    const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
    return +((x + 0.05) / (y + 0.05)).toFixed(2);
  };

  console.log(`\n── ${scheme} ─────────────────────────────`);
  console.log('dump height:', grow);
  console.log('tab order:', tabOrder);
  console.log('disabled primary label on fill:', ratio(colors.ground, colors.disabledPrimaryFill), '(informational — WCAG exempts inactive controls)');
  console.log('placeholder (dim) on field:    ', ratio(colors.dim, colors.raised), '(needs 4.5)');
  console.log('primary label (ground) on ember:', ratio(colors.ground, colors.ember), '(needs 4.5)');
  console.log('page errors:', errors.length ? errors : 'none');
  await ctx.close();
}
await browser.close();

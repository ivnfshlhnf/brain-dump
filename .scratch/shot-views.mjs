import { chromium } from 'playwright';
const out = '/Users/ivanhanif/personal/shared-dev/brain-dump/.scratch/shots/critique-a';
const browser = await chromium.launch();
for (const scheme of ['light','dark']) {
  for (const vp of [{n:'desktop',w:1280,h:900},{n:'phone',w:390,h:844}]) {
    const ctx = await browser.newContext({ colorScheme: scheme, viewport:{width:vp.w,height:vp.h}, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto('http://localhost:5173', { waitUntil:'load' });
    await page.evaluate(() => document.fonts.ready);
    // ask
    await page.getByRole('button', { name: 'ask', exact: true }).click();
    await page.waitForTimeout(120);
    await page.screenshot({ path: `${out}/${vp.n}-${scheme}-ask.png`, fullPage: true });
    // config
    await page.getByRole('button', { name: 'config', exact: true }).click();
    await page.waitForTimeout(120);
    await page.screenshot({ path: `${out}/${vp.n}-${scheme}-config.png`, fullPage: true });
    // capture with text typed (enabled primary)
    await page.getByRole('button', { name: 'capture', exact: true }).click();
    await page.waitForTimeout(80);
    await page.fill('textarea.dump', 'the thing about the outbox is that it should retry on a timer as well, because online never fires when the portal is captive');
    await page.waitForTimeout(120);
    await page.screenshot({ path: `${out}/${vp.n}-${scheme}-typed.png`, fullPage: true });
    await ctx.close();
  }
}
await browser.close();
console.log('done');

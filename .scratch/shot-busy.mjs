import { chromium } from 'playwright';
const out='/Users/ivanhanif/personal/shared-dev/brain-dump/.scratch/shots/critique-a';
const browser = await chromium.launch();
for (const scheme of ['light']) {
  const ctx = await browser.newContext({ colorScheme: scheme, viewport:{width:390,height:500}, deviceScaleFactor:2 });
  const page = await ctx.newPage();
  await page.goto('http://localhost:5173',{waitUntil:'load'});
  await page.evaluate(()=>document.fonts.ready);
  await page.fill('textarea.dump','the thing about the outbox is that it should retry on a timer as well');
  await page.evaluate(()=>{ const t=document.querySelector('textarea.dump'); t.disabled=true; const b=document.querySelector('button.primary'); b.disabled=true; });
  await page.waitForTimeout(150);
  await page.screenshot({path:`${out}/phone-${scheme}-busy.png`, fullPage:true});
  await ctx.close();
}
await browser.close();
console.log('ok');

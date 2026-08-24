// Polish pass (10): the whole path at both widths in both schemes, plus the computed
// measurements that a screenshot cannot state — target sizes, resolved colours, the
// font actually used by <code>.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}
const url = arg('url', 'http://localhost:5173');
const out = arg('out', '.scratch/shots/pass-10');
await mkdir(out, { recursive: true });

const browser = await chromium.launch();
const measurements = [];

for (const scheme of ['light', 'dark']) {
  for (const vp of [{ n: 'desktop', w: 1280, h: 900 }, { n: 'phone', w: 390, h: 844 }]) {
    const ctx = await browser.newContext({
      colorScheme: scheme,
      viewport: { width: vp.w, height: vp.h },
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const tag = `${vp.n}-${scheme}`;

    // capture, empty — the arrival screen
    await page.screenshot({ path: `${out}/${tag}-capture-empty.png`, fullPage: true });

    // ask
    await page.getByRole('button', { name: 'ask', exact: true }).click();
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${out}/${tag}-ask.png`, fullPage: true });

    // settings — the wall of fields, plus a seeded health report and diagnostics so the
    // check marks and the log rows are actually on screen.
    await page.getByRole('button', { name: 'settings', exact: true }).click();
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${out}/${tag}-settings.png`, fullPage: true });


    // The health report and the log are only reachable with a real CouchDB + LLM (and the
    // connection test spends credit), so the two lists are stamped in with the real classes.
    await page.evaluate(() => {
      const rows = [
        { ok: true, name: 'CouchDB', msg: 'reachable, 1,284 documents' },
        { ok: true, name: 'Chat', msg: 'deepseek/deepseek-v4-flash answered in 412ms' },
        { ok: false, name: 'Embeddings', msg: 'no API key set for openai/text-embedding-3-small' },
        { ok: true, name: 'Database creation', msg: 'account may create databases' },
      ];
      const mark = (ok) => `<svg class="check-mark" viewBox="0 0 16 16" aria-hidden="true">${
        ok ? '<path d="M3.5 8.5 6.5 11.5 12.5 4.5" />' : '<path d="M4.5 4.5 11.5 11.5 M11.5 4.5 4.5 11.5" />'
      }</svg>`;
      const checks = document.createElement('ul');
      checks.className = 'checks';
      checks.innerHTML = rows.map((r) => `<li class="${r.ok ? '' : 'err'}">${mark(r.ok)}<span><span class="sr-only">${r.ok ? 'Passed:' : 'Failed:'}</span> <strong>${r.name}</strong> — ${r.msg}</span></li>`).join('');
      document.querySelectorAll('.actions')[1].after(checks);

      const log = document.querySelector('.diagnostics');
      const events = [
        ['09:41:07', 'capture', 'dump written', '{"id":"2026-08-24T09-41-07","bytes":218}'],
        ['09:41:09', 'organize', 'note organized', '{"title":"Outbox retry on a timer","tags":3}'],
        ['09:41:11', 'related', 'ranked vault', '{"candidates":1284,"shortlist":8}'],
        ['09:08:52', 'config', 'settings rejected', '{"problem":"not-https"}'],
      ];
      log.innerHTML = events.map(([t, op, m, d], i) => `<li class="${i === 3 ? 'err' : ''}"><code>${t}</code> <strong>${op}</strong> ${m} <code class="detail">${d}</code></li>`).join('');
    });
    await page.waitForTimeout(120);
    await page.screenshot({ path: `${out}/${tag}-settings-full.png`, fullPage: true });

    if (vp.n === 'desktop') {
      measurements.push(await page.evaluate((scheme) => {
        const px = (el) => { const r = el.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; };
        const cs = (el, p) => getComputedStyle(el).getPropertyValue(p);
        const box = document.querySelector('input[type=checkbox]');
        const legend = document.querySelector('.field-group > legend');
        const firstInput = document.querySelector('input:not([type=checkbox])');
        return {
          scheme,
          where: 'settings',
          checkbox: px(box),
          checkboxRow: px(box.closest('label')),
          checkboxRowDirection: cs(box.closest('label'), 'flex-direction'),
          textInput: px(firstInput),
          legend: px(legend),
          legendHasRule: getComputedStyle(legend, '::after').content !== 'none',
          legendDisplay: cs(legend, 'display'),
          fieldGroups: document.querySelectorAll('.field-group').length,
          scrollbarColor: cs(document.documentElement, 'scrollbar-color'),
          caret: cs(firstInput, 'caret-color'),
          codeFont: cs(document.querySelector('.diagnostics code'), 'font-family').split(',')[0],
          codeTabular: cs(document.querySelector('.diagnostics code'), 'font-variant-numeric'),
          checkMark: px(document.querySelector('.check-mark')),
        };
      }, scheme));
    }

    // The Ask answer card, likewise unreachable without a real vault.
    await page.getByRole('button', { name: 'ask', exact: true }).click();
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      const s = document.createElement('section');
      s.className = 'answer';
      s.innerHTML = `<p>You settled on writing the raw Dump to the Vault before anything else runs, so a model or network failure downstream can only cost you the organizing, never the thought. The outbox came later, to cover the case where even that first write cannot reach CouchDB.</p><p class="rule-label">sources</p><ul class="sources"><li><a class="vault-link" href="#">Offline capture and the outbox</a></li><li><a class="vault-link" href="#">ADR-0002 — Managed folders</a></li></ul>`;
      document.querySelector('.surface').append(s);
    });
    await page.waitForTimeout(120);
    await page.screenshot({ path: `${out}/${tag}-ask-answered.png`, fullPage: true });

    // back to capture, typed — the enabled primary
    await page.getByRole('button', { name: 'capture', exact: true }).click();
    await page.waitForTimeout(100);
    await page.fill('textarea.dump', 'the outbox should retry on a timer as well, because online never fires when the portal is captive');
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${out}/${tag}-capture-typed.png`, fullPage: true });

    if (vp.n === 'desktop') {
      measurements.push(await page.evaluate((scheme) => {
        const dump = document.querySelector('textarea.dump');
        const cs = (el, p) => getComputedStyle(el).getPropertyValue(p);
        const primary = document.querySelector('button.primary');
        // The resting state of the arrival screen: empty Dump, disabled Capture.
        dump.value = '';
        dump.dispatchEvent(new Event('input', { bubbles: true }));
        const disabledFill = getComputedStyle(document.querySelector('button.primary')).backgroundColor;
        return {
          scheme,
          where: 'capture',
          dumpAccessibleName: dump.getAttribute('aria-label') ?? '(none)',
          dumpResize: cs(dump, 'resize'),
          dumpFieldSizing: cs(dump, 'field-sizing'),
          dumpHeight: Math.round(dump.getBoundingClientRect().height),
          placeholderColor: cs(dump, 'color') && (() => {
            const st = document.createElement('style');
            st.textContent = 'textarea.dump::placeholder{--probe:1}';
            document.head.append(st);
            return getComputedStyle(dump, '::placeholder').color;
          })(),
          disabledPrimaryFill: disabledFill,
          h1: document.querySelector('h1')?.textContent,
          h1Font: cs(document.querySelector('h1'), 'font-size'),
          headerParent: document.querySelector('header')?.parentElement?.className,
          landmarks: [...document.querySelectorAll('header, main')].map((e) => e.tagName + '<' + e.parentElement.tagName + (e.parentElement.className ? '.' + e.parentElement.className : '')).join(' '),
          ariaCurrent: [...document.querySelectorAll('nav button')].map((b) => `${b.textContent.trim()}:${b.getAttribute('aria-current') ?? '-'}`).join(' '),
          selectionBg: (() => {
            const d = document.createElement('div');
            document.body.append(d);
            d.style.background = 'color-mix(in oklab, ' + cs(document.documentElement, '--ember') + ', transparent 78%)';
            const v = getComputedStyle(d).backgroundColor; d.remove(); return v;
          })(),
        };
      }, scheme));
    }

    await ctx.close();
  }
}

await browser.close();
console.log(JSON.stringify(measurements, null, 2));

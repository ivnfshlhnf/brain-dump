// Every `var(--token)` must resolve to a token that is actually defined.
//
// This exists because four of them did not. `--hairline`, `--surface` and `--ink` were
// referenced by the status strip and defined nowhere, and CSS fails silently here: a `var()`
// with no fallback makes the whole declaration invalid at computed-value time, so
// `border: 1px solid var(--hairline)` does not fall back to a default border — it drops the
// border entirely. The strip shipped with no border, no background, and no visual difference
// between an alert and a receipt, and nothing said a word. A screenshot of an element with no
// chrome looks exactly like a screenshot of an element whose chrome is correct.
//
// The view has no test seam by deliberate choice (`.scratch/rolodex/spec.md`), which makes the
// silent-failure class of bug the one worth spending a permanent check on.
//
//   node scripts/check-tokens.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

/** Every file that can define or reference a custom property. Svelte counts: a card's hue
 *  arrives as an inline `style="--cat-hue: …"`, so definitions are not all in the stylesheet. */
function sources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.(css|svelte)$/.test(path)) out.push(path);
  }
  return out;
}

const files = sources(join(ROOT, 'src'));
const defined = new Set();
const referenced = [];

for (const file of files) {
  const text = readFileSync(file, 'utf8');

  // A definition is `--name:` — a declaration, never a `var()` reference, which has no colon.
  for (const m of text.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);

  // A reference is `var(--name)` or `var(--name, fallback)`. The second form is safe on its
  // own: an undefined token with a fallback degrades rather than voiding the declaration.
  for (const m of text.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
    referenced.push({
      token: m[1],
      hasFallback: m[2] === ',',
      file: relative(ROOT, file),
      line: text.slice(0, m.index).split('\n').length,
    });
  }
}

const dead = referenced.filter((r) => !r.hasFallback && !defined.has(r.token));

if (dead.length === 0) {
  console.log(`✓ ${referenced.length} var() references, ${defined.size} tokens defined, none dead.`);
  process.exit(0);
}

console.error(`✗ ${dead.length} var() reference(s) resolve to nothing:\n`);
for (const d of dead) console.error(`  ${d.file}:${d.line}  var(${d.token})`);
console.error(`\nA var() with no fallback and no definition voids the whole declaration —`);
console.error(`the property is not applied at all. Define the token, or give it a fallback.`);
process.exit(1);

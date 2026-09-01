// The browser-check runner: every scripts/check-*.mjs is a standalone real-browser check
// that is hermetic by construction — own server on a random port, own browser, own seeded
// store — so the runner needs no ordering and walks the directory alphabetically. Adding a
// check means adding a file; nothing else edits. check-tokens.mjs is not a browser check
// (it runs inside `npm run build`, before vite bundles, so a token slip never ships).
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = new URL('.', import.meta.url);
const checks = readdirSync(here)
  .filter((f) => /^check-.*\.mjs$/.test(f) && f !== 'check-tokens.mjs')
  .sort();

for (const check of checks) {
  console.log(`\n── ${check}`);
  const run = spawnSync('node', [fileURLToPath(new URL(check, here))], { stdio: 'inherit' });
  if (run.status !== 0) {
    console.error(`\nFAIL ${check}`);
    process.exit(1);
  }
}
console.log(`\nAll ${checks.length} browser checks pass.`);
// Shared harness for the check-*.mjs real-browser checks. Each check stays a
// standalone script with its own server, browser, and seed data; this file only
// gathers what was copy-pasted between them, so the next check starts here instead
// of from a seventh copy.

/** The engines field pins Node ≥ 20.19 (the service-worker bundling step needs it);
 *  checks that build the PWA call this first, so the failure names the fix instead of
 *  surfacing as a confusing build error. */
export function ensureNode() {
  const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
  if (nodeMajor < 20 || (nodeMajor === 20 && nodeMinor < 19)) {
    console.error(
      `This check builds the PWA, and the service-worker bundling step needs Node ≥ 20.19 ` +
        `(found ${process.version}; the repo pins 22 in .nvmrc). Run: nvm use`,
    );
    process.exit(1);
  }
}

/** Seed the app's IndexedDB before the app reads it: the stores to open, the card list
 *  to write into `note-cards` (omit for a cold cache), and the settings record the app
 *  loads at boot. Call after `goto`, before the app has read the store. */
export async function seedStore(page, seed) {
  await page.evaluate(async (s) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('brain-dump', 6);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction(s.stores, 'readwrite');
      if (s.cards && s.cards.length) tx.objectStore('note-cards').put(s.cards, 'all');
      tx.objectStore('settings').put(s.settings, 'current');
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, seed);
}
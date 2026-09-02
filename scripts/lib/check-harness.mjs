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
/** Fulfil a Playwright route for `chat/completions` the way the app's two transports
 *  expect: a streamed request (`stream: true` on the body, capture-latency ticket 07)
 *  gets an SSE reply whose chunks reassemble into the same JSON, everything else gets
 *  the plain JSON body as before. `json` is the Organize-style output object. */
export async function fulfillChat(route, json) {
  const body = route.request().postDataJSON();
  if (body?.stream !== true) {
    return route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'check', choices: [{ message: { role: 'assistant', content: JSON.stringify(json) } }] }),
    });
  }
  const content = JSON.stringify(json);
  const chunk = (delta, usage) =>
    `data: ${JSON.stringify({
      ...(delta === undefined ? { choices: [] } : { choices: [{ delta: { content: delta } }] }),
      ...(usage ? { usage } : {}),
    })}\n\n`;
  // Split the JSON mid-token so the accumulation path is exercised, like the real reply.
  const pieces = content.match(/.{1,12}/gs) ?? [];
  const sse = [
    ...pieces.map((p) => chunk(p)),
    chunk(undefined, { prompt_tokens: 10, completion_tokens: 20, reasoning_tokens: 0 }),
    'data: [DONE]\n\n',
  ].join('');
  return route.fulfill({
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    body: sse,
  });
}

// Fulfil a Playwright route for the CouchDB obsidian store the way PouchDB's HTTP adapter
// uses it: PUT writes, `GET _all_docs` scans the store, and — since the vault chunk read was
// batched into one keys query (capture-latency ticket 08) — `POST _all_docs` answers in
// key order with an `error` row for a key that is not in the store. Everything else is a
// GET by id, 404 when absent. `vaultDocs` is the caller's Map, so a check can seed it and
// watch what the app wrote.
export async function handleCouch(route, vaultDocs) {
  const method = route.request().method();
  const id = decodeURIComponent(route.request().url().split('/couch/obsidian/')[1].split('?')[0]);
  if (method === 'PUT') {
    vaultDocs.set(id, route.request().postDataJSON());
    return route.fulfill({ status: 201, body: JSON.stringify({ ok: true, id, rev: '1-check' }) });
  }
  if (id === '_all_docs') {
    const rowFor = (key, doc) =>
      doc
        ? { id: key, doc: { _id: key, ...doc }, value: { rev: '1-check' } }
        : { id: key, error: 'not_found' };
    const rows =
      method === 'POST'
        ? (route.request().postDataJSON()?.keys ?? []).map((key) => rowFor(key, vaultDocs.get(key)))
        : [...vaultDocs.entries()].map(([key, doc]) => rowFor(key, doc));
    return route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ offset: 0, rows, total_rows: rows.length }),
    });
  }
  const doc = vaultDocs.get(id);
  if (doc) {
    return route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ _id: id, ...doc }),
    });
  }
  return route.fulfill({ status: 404, body: JSON.stringify({ error: 'not_found' }) });
}

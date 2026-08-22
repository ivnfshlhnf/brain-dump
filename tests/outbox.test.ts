// Seam A — offline capture and reconnect, tested as black boxes through the
// operation layer. CouchDB is the in-memory PouchDB stand-in; the Organizer is a
// deterministic fake; the outbox is the real IndexedDB implementation driven
// against fake-indexeddb, so durability is asserted on real IndexedDB semantics.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import PouchDB from 'pouchdb-core';
import memory from 'pouchdb-adapter-memory';
import {
  captureOrQueue,
  drainOutbox,
  OFFLINE_CAPTURE_MESSAGE,
  CAPTURE_RETRY_MESSAGE,
} from '../src/lib/operations';
import { createIndexedDbOutbox } from '../src/lib/outbox';
import { docIdForPath } from '../src/lib/livesync';
import {
  DEFAULT_SETTINGS,
  type Settings,
  type DocStore,
  type Organizer,
  type OrganizeOutput,
  type Matcher,
  type OutboxStore,
} from '../src/lib/types';

PouchDB.plugin(memory);

function sha1Hex(c: string): Promise<string> {
  return Promise.resolve(createHash('sha1').update(c).digest('hex'));
}

const fixedNow = Date.UTC(2026, 7, 21, 20, 30, 45); // 2026-08-21 20:30:45 UTC
const fixedId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const settings: Settings = { ...DEFAULT_SETTINGS, dumpsFolder: '_dumps', managedFolder: 'Brain Dump' };

const sampleOutput: OrganizeOutput = {
  title: 'Water the plants',
  tags: ['home', 'plants'],
  category: 'Home',
  summary: 'A reminder to water the plants.',
  keyPoints: ['Water the plants regularly'],
  related: ['[[plants]]'],
  body: 'I keep forgetting to water the plants.',
};

const newOnlyMatcher: Matcher = { match: async () => ({ kind: 'new' }) };
const organizer: Organizer = { organize: async () => sampleOutput };

let db: DocStore;
let outbox: OutboxStore;
let seq = 0;

beforeEach(async () => {
  db = new PouchDB('o' + seq++, { adapter: 'memory' }) as unknown as DocStore;
  // A fresh IndexedDB per test — fake-indexeddb keeps one global factory otherwise.
  globalThis.indexedDB = new IDBFactory();
  outbox = createIndexedDbOutbox();
});

const captureDeps = (opts: { online: boolean; db?: DocStore; id?: string; now?: number }) => ({
  db: opts.db ?? db,
  settings,
  organizer,
  matcher: newOnlyMatcher,
  outbox,
  isOnline: () => opts.online,
  now: () => opts.now ?? fixedNow,
  newId: () => opts.id ?? fixedId,
  hash: sha1Hex,
});

const drainDeps = () => ({ db, settings, organizer, outbox, hash: sha1Hex, isOnline: () => true });

/** Every metadata doc path stored in CouchDB (the observable vault contents). */
async function storedPaths(): Promise<string[]> {
  const all = await db.allDocs<{ type?: string; path?: string }>({ include_docs: true });
  return all.rows
    .map((r) => r.doc)
    .filter((d): d is { type: string; path: string } => d?.type === 'plain' && !!d.path)
    .map((d) => d.path);
}

async function contentAt(path: string): Promise<string> {
  const meta = await db.get<{ children: string[] }>(docIdForPath(path, settings));
  const chunk = await db.get<{ data: string }>(meta.children[0]);
  return chunk.data;
}

describe('offline capture (Seam A)', () => {
  it('queues the Dump in the outbox and produces no Note or preview', async () => {
    const outcome = await captureOrQueue(
      'I keep forgetting to water the plants',
      captureDeps({ online: false }),
    );

    expect(outcome.kind).toBe('queued');
    if (outcome.kind !== 'queued') throw new Error('expected queued');
    expect(outcome.reason).toBe('offline');
    expect(outcome.message).toBe(OFFLINE_CAPTURE_MESSAGE);
    expect(outcome.dump.content).toBe('I keep forgetting to water the plants');

    // No preview, and nothing written to the vault at all — Organize is online-only.
    expect(await storedPaths()).toEqual([]);

    // The Dump is safe in the outbox.
    const queued = await outbox.list();
    expect(queued).toHaveLength(1);
    expect(queued[0].content).toBe('I keep forgetting to water the plants');
    expect(queued[0].createdAt).toBe(fixedNow);
    expect(queued[0].modality).toBe('text');
  });

  it('captures online as a normal review session (preview, nothing queued)', async () => {
    const outcome = await captureOrQueue('a thought', captureDeps({ online: true }));

    expect(outcome.kind).toBe('session');
    if (outcome.kind !== 'session') throw new Error('expected session');
    expect(outcome.session.preview.title).toBe('Water the plants');
    expect(await outbox.list()).toEqual([]);
  });

  it('rejects an empty brain-dump rather than queueing it', async () => {
    await expect(captureOrQueue('   ', captureDeps({ online: false }))).rejects.toThrow();
    expect(await outbox.list()).toEqual([]);
  });

  it('never loses the Dump when an online capture fails mid-flight', async () => {
    // The connection drops after `isOnline()` said yes — the write throws.
    const failing: DocStore = {
      put: async () => {
        throw new Error('network down');
      },
      get: async () => {
        throw new Error('network down');
      },
      allDocs: async () => ({ rows: [] }),
    };

    const outcome = await captureOrQueue(
      'a thought mid-flight',
      captureDeps({ online: true, db: failing }),
    );

    expect(outcome.kind).toBe('queued');
    if (outcome.kind !== 'queued') throw new Error('expected queued');
    const queued = await outbox.list();
    expect(queued).toHaveLength(1);
    expect(queued[0].content).toBe('a thought mid-flight');

    // The user is online, so they are not told they are offline: the outcome says the
    // capture failed, names the retry, and carries the underlying error.
    expect(outcome.reason).toBe('capture-failed');
    expect(outcome.message).toBe(CAPTURE_RETRY_MESSAGE);
    expect(outcome.error?.message).toBe('network down');
  });

  it('drains a Dump that fell back after a failed online capture, without duplicating it', async () => {
    const failing: DocStore = {
      put: async () => {
        throw new Error('network down');
      },
      get: async () => {
        throw new Error('network down');
      },
      allDocs: async () => ({ rows: [] }),
    };
    await captureOrQueue('a thought mid-flight', captureDeps({ online: true, db: failing }));

    // The connection recovers: the same Dump id and capture time are reused, so the
    // drain writes one Dump file and one Note.
    const result = await drainOutbox(drainDeps());

    expect(result.organized).toHaveLength(1);
    expect((await storedPaths()).sort()).toEqual(
      ['Brain Dump/2026-08-21-water-the-plants.md', '_dumps/20260821-203045-aaaaaa.md'].sort(),
    );
    expect(await outbox.list()).toEqual([]);
  });
});

describe('reconnect drain (Seam A)', () => {
  it('syncs the queued Dump to CouchDB and Organizes it into a Note', async () => {
    await captureOrQueue('I keep forgetting to water the plants', captureDeps({ online: false }));

    const result = await drainOutbox(drainDeps());

    expect(result.failed).toEqual([]);
    expect(result.organized).toHaveLength(1);
    expect(result.organized[0].note.title).toBe('Water the plants');

    // The Dump landed in _dumps/, verbatim, dated by its capture time (not the sync time).
    const dumpPath = '_dumps/20260821-203045-aaaaaa.md';
    expect(await contentAt(dumpPath)).toContain('I keep forgetting to water the plants');

    // The Note landed in the managed folder, dated by the capture time.
    const notePath = 'Brain Dump/2026-08-21-water-the-plants.md';
    const note = await contentAt(notePath);
    expect(note).toContain('title: Water the plants');
    expect(note).toContain(`source: [[${dumpPath.replace(/\.md$/, '')}]]`);

    expect((await storedPaths()).sort()).toEqual([notePath, dumpPath].sort());

    // The outbox is drained.
    expect(await outbox.list()).toEqual([]);
  });

  it('drains multiple queued Dumps in capture order', async () => {
    await captureOrQueue('first', captureDeps({ online: false, id: 'id-one', now: fixedNow }));
    await captureOrQueue(
      'second',
      captureDeps({ online: false, id: 'id-two', now: fixedNow + 60_000 }),
    );

    const result = await drainOutbox(drainDeps());

    expect(result.organized.map((o) => o.dump.content)).toEqual(['first', 'second']);
    expect(await outbox.list()).toEqual([]);
  });

  it('does nothing while still offline — the queue is untouched', async () => {
    await captureOrQueue('still offline', captureDeps({ online: false }));

    const result = await drainOutbox({ ...drainDeps(), isOnline: () => false });

    expect(result.organized).toEqual([]);
    expect(await storedPaths()).toEqual([]);
    expect(await outbox.list()).toHaveLength(1);
  });

  it('keeps the Dump queued when Organize fails, and organizes it on the next drain', async () => {
    await captureOrQueue('a thought', captureDeps({ online: false }));

    let fail = true;
    const flaky: Organizer = {
      organize: async () => {
        if (fail) throw new Error('LLM unavailable');
        return sampleOutput;
      },
    };

    const first = await drainOutbox({ ...drainDeps(), organizer: flaky });
    expect(first.organized).toEqual([]);
    expect(first.failed).toHaveLength(1);
    expect(await outbox.list()).toHaveLength(1); // the Dump is not lost
    // No Note yet — but the raw Dump has already been synced, so it is safe in the vault.
    expect(await storedPaths()).toEqual(['_dumps/20260821-203045-aaaaaa.md']);

    fail = false;
    const second = await drainOutbox({ ...drainDeps(), organizer: flaky });
    expect(second.organized).toHaveLength(1);
    expect(await outbox.list()).toEqual([]);
    expect((await storedPaths()).sort()).toEqual(
      ['Brain Dump/2026-08-21-water-the-plants.md', '_dumps/20260821-203045-aaaaaa.md'].sort(),
    );
  });
});

describe('outbox durability', () => {
  it('survives an app restart — a fresh outbox over the same IndexedDB still has the Dump', async () => {
    await captureOrQueue('survive a reload', captureDeps({ online: false }));

    // A new session (a fresh store handle over the same IndexedDB database).
    const reopened = createIndexedDbOutbox();
    const queued = await reopened.list();

    expect(queued).toHaveLength(1);
    expect(queued[0].content).toBe('survive a reload');

    // And it drains from the reopened handle.
    const result = await drainOutbox({ ...drainDeps(), outbox: reopened });
    expect(result.organized).toHaveLength(1);
    expect(await createIndexedDbOutbox().list()).toEqual([]);
  });

  it('keeps queued Dumps distinct and removes only the drained one', async () => {
    await captureOrQueue('one', captureDeps({ online: false, id: 'id-one' }));
    await captureOrQueue('two', captureDeps({ online: false, id: 'id-two', now: fixedNow + 1000 }));

    await outbox.remove('id-one');

    const queued = await createIndexedDbOutbox().list();
    expect(queued.map((d) => d.content)).toEqual(['two']);
  });
});

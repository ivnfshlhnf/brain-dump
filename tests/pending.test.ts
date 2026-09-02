// Seam A — Pending Dumps, recovery and reconciliation, tested as black boxes through
// the operation layer. CouchDB is the in-memory PouchDB stand-in; the Organizer is a
// deterministic fake; the Pending store is the real IndexedDB implementation driven
// against fake-indexeddb, so durability is asserted on real IndexedDB semantics.
//
// The interruption that strands a Dump (dogfooding finding 02) is modelled the way it
// actually happens: an Organize that never settles, because the tab was backgrounded or
// killed mid-fetch. Nothing throws — which is precisely why a catch could never see it.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import PouchDB from 'pouchdb-core';
import memory from 'pouchdb-adapter-memory';
import {
  captureThought,
  addContext,
  settleMatch,
  finalizeCapture,
  recoverPending,
  writeNote,
  adoptInterrupted,
  retryPending,
  findStrandedDumps,
  findDismissedDumps,
  restoreStranded,
  sourceWikilink,
  parseDumpFile,
  dumpFileContent,
  dumpPath,
  isStranded,
  MAX_ORGANIZE_ATTEMPTS,
  RETRY_BACKOFF_MS,
  OFFLINE_CAPTURE_MESSAGE,
  CAPTURE_RETRY_MESSAGE,
} from '../src/lib/operations';
import { createIndexedDbPendingStore } from '../src/lib/pending';
import { createIndexedDbDismissedStore } from '../src/lib/dismissed';
import { docIdForPath } from '../src/lib/livesync';
import {
  DEFAULT_SETTINGS,
  type Settings,
  type DocStore,
  type Dump,
  type Organizer,
  type OrganizeOutput,
  type Matcher,
  type Modality,
  type Embedder,
  type Relater,
  type PendingStore,
} from '../src/lib/types';
import type { OnStatus } from '../src/lib/status';

PouchDB.plugin(memory);

function sha1Hex(c: string): Promise<string> {
  return Promise.resolve(createHash('sha1').update(c).digest('hex'));
}

const fixedNow = Date.UTC(2026, 7, 21, 20, 30, 45); // 2026-08-21 20:30:45 UTC
const fixedId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const dumpFile = '_dumps/20260821-203045-aaaaaa.md';
const settings: Settings = { ...DEFAULT_SETTINGS, dumpsFolder: '_dumps', managedFolder: 'Brain Dump' };

const sampleOutput: OrganizeOutput = {
  title: 'Water the plants',
  tags: ['home', 'plants'],
  category: 'personal',
  summary: 'A reminder to water the plants.',
  keyPoints: ['Water the plants regularly'],
  related: ['[[plants]]'],
  body: 'I keep forgetting to water the plants.',
};

const newOnlyMatcher: Matcher = { match: async () => ({ kind: 'new' }) };
const organizer: Organizer = { organize: async () => sampleOutput };
/** Echoes back what it was asked to Organize — lets a test see the exact text that
 *  reached the LLM (original, or original + Context). */
const echoOrganizer: Organizer = {
  organize: async (content) => ({ ...sampleOutput, body: content }),
};
/** Never settles: the tab was backgrounded mid-Organize. */
const hangingOrganizer: Organizer = { organize: () => new Promise<OrganizeOutput>(() => {}) };

/** A DocStore that is down — every read and write throws. */
const failingDb: DocStore = {
  put: async () => {
    throw new Error('network down');
  },
  get: async () => {
    throw new Error('network down');
  },
  allDocs: async () => ({ rows: [] }),
};

let db: DocStore;
let pending: PendingStore;
let now: number;
let seq = 0;

beforeEach(async () => {
  db = new PouchDB('o' + seq++, { adapter: 'memory' }) as unknown as DocStore;
  // A fresh IndexedDB per test — fake-indexeddb keeps one global factory otherwise.
  globalThis.indexedDB = new IDBFactory();
  pending = createIndexedDbPendingStore();
  now = fixedNow;
});

const captureDeps = (opts: {
  online: boolean;
  db?: DocStore;
  id?: string;
  now?: number;
  organizer?: Organizer;
  onPending?: (dump: Dump) => void;
  onStatus?: OnStatus;
}) => ({
  db: opts.db ?? db,
  settings,
  organizer: opts.organizer ?? organizer,
  matcher: newOnlyMatcher,
  pending,
  isOnline: () => opts.online,
  now: () => opts.now ?? fixedNow,
  newId: () => opts.id ?? fixedId,
  hash: sha1Hex,
  onPending: opts.onPending,
  onStatus: opts.onStatus,
});

const recoverDeps = (over: Partial<Parameters<typeof recoverPending>[0]> = {}) => ({
  db,
  settings,
  organizer,
  pending,
  hash: sha1Hex,
  isOnline: () => true,
  now: () => now,
  ...over,
});

const finalizeDeps = () => ({
  db,
  settings,
  organizer,
  pending,
  hash: sha1Hex,
  now: () => now,
});

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

async function notePaths(): Promise<string[]> {
  return (await storedPaths()).filter((p) => p.startsWith('Brain Dump/'));
}

describe('enrolment: every Capture is Pending before anything can fail', () => {
  it('records the Dump durably while the Organize is still in flight', async () => {
    // Deliberately not awaited: this is the state of the world *during* the Organize,
    // which is the moment the tab dies. This assertion is the whole of finding 02 —
    // before the fix the store was empty here, so nothing knew the Dump existed.
    void captureThought('a thought that gets interrupted', {
      ...captureDeps({ online: true, organizer: hangingOrganizer }),
    });
    await new Promise((r) => setTimeout(r, 50));

    const records = await pending.list();
    expect(records).toHaveLength(1);
    expect(records[0].reason).toBe('in-flight');
    expect(records[0].dump.content).toBe('a thought that gets interrupted');
    expect(records[0].attempts).toBe(0);
  });

  it('tells the caller the Dump is safe before the Organize is even attempted', async () => {
    const safeAt: string[] = [];
    void captureThought('safe the moment it is taken', {
      ...captureDeps({
        online: true,
        organizer: hangingOrganizer,
        onPending: (dump) => safeAt.push(dump.content),
      }),
    });
    await new Promise((r) => setTimeout(r, 50));

    // The UI clears its draft here — leaving the text on screen is what invited the
    // three duplicate presses in finding 02.
    expect(safeAt).toEqual(['safe the moment it is taken']);
  });

  it('queues the Dump when offline, and produces no Note or preview', async () => {
    const outcome = await captureThought(
      'I keep forgetting to water the plants',
      captureDeps({ online: false }),
    );

    expect(outcome.kind).toBe('pending');
    if (outcome.kind !== 'pending') throw new Error('expected pending');
    expect(outcome.reason).toBe('offline');
    expect(outcome.message).toBe(OFFLINE_CAPTURE_MESSAGE);

    // No preview, and nothing written to the vault at all — Organize is online-only.
    expect(await storedPaths()).toEqual([]);

    const records = await pending.list();
    expect(records).toHaveLength(1);
    expect(records[0].reason).toBe('offline');
    expect(records[0].dump.content).toBe('I keep forgetting to water the plants');
    expect(records[0].dump.createdAt).toBe(fixedNow);
    expect(records[0].enrolledAt).toBe(fixedNow);
  });

  it('captures online as a normal review session, and the Dump stays Pending until saved', async () => {
    const outcome = await captureThought('a thought', captureDeps({ online: true }));

    expect(outcome.kind).toBe('session');
    if (outcome.kind !== 'session') throw new Error('expected session');
    expect(outcome.session.preview.title).toBe('Water the plants');

    // The preview is not the Note. Until the Note is written the thought is unfiled.
    const records = await pending.list();
    expect(records).toHaveLength(1);
    expect(records[0].reason).toBe('in-flight');
  });

  it('rejects an empty brain-dump rather than enrolling it', async () => {
    await expect(captureThought('   ', captureDeps({ online: false }))).rejects.toThrow();
    expect(await pending.list()).toEqual([]);
  });

  it('leaves the Dump Pending and marked failed when an online capture throws', async () => {
    const outcome = await captureThought(
      'a thought mid-flight',
      captureDeps({ online: true, db: failingDb }),
    );

    expect(outcome.kind).toBe('pending');
    if (outcome.kind !== 'pending') throw new Error('expected pending');
    // The user is online, so they are not told they are offline.
    expect(outcome.reason).toBe('capture-failed');
    expect(outcome.message).toBe(CAPTURE_RETRY_MESSAGE);
    expect(outcome.error?.message).toBe('network down');

    const [record] = await pending.list();
    expect(record.reason).toBe('failed');
    expect(record.attempts).toBe(1);
    expect(record.lastError).toBe('network down');
    expect(record.nextAttemptAt).toBe(fixedNow + RETRY_BACKOFF_MS[0]);
  });

  it('stops being Pending once the Note is written', async () => {
    const outcome = await captureThought('a thought', captureDeps({ online: true }));
    if (outcome.kind !== 'session') throw new Error('expected session');

    const settled = await settleMatch(outcome.session, { db, settings, matcher: newOnlyMatcher });
    const result = await finalizeCapture(settled, finalizeDeps());

    expect(result.ok).toBe(true);
    expect(await pending.list()).toEqual([]);
  });

  it('stays Pending when the Note fails to write', async () => {
    const outcome = await captureThought('a thought', captureDeps({ online: true }));
    if (outcome.kind !== 'session') throw new Error('expected session');

    const settled = await settleMatch(outcome.session, { db, settings, matcher: newOnlyMatcher });
    const result = await finalizeCapture(settled, { ...finalizeDeps(), db: failingDb });

    expect(result.ok).toBe(false);
    expect(await pending.list()).toHaveLength(1);
  });
});

describe('status line: the strip is fed by the operation layer, not the view', () => {
  it('announces a capture that landed offline via the onStatus callback', async () => {
    const seen: { kind: string; message: string }[] = [];
    const outcome = await captureThought(
      'I keep forgetting to water the plants',
      captureDeps({ online: false, onStatus: (m) => seen.push(m) }),
    );
    if (outcome.kind !== 'pending') throw new Error('expected pending');

    expect(seen).toHaveLength(1);
    expect(seen[0].kind).toBe('capture-confirmed');
    expect(seen[0].message).toBe(`Captured — ${OFFLINE_CAPTURE_MESSAGE}.`);
  });

  it('announces a capture that failed while online, naming the error — not "you are offline"', async () => {
    const seen: { kind: string; message: string }[] = [];
    const outcome = await captureThought(
      'a thought mid-flight',
      captureDeps({ online: true, db: failingDb, onStatus: (m) => seen.push(m) }),
    );
    if (outcome.kind !== 'pending') throw new Error('expected pending');

    expect(seen).toHaveLength(1);
    expect(seen[0].kind).toBe('capture-confirmed');
    expect(seen[0].message).toBe(`Captured — ${CAPTURE_RETRY_MESSAGE}. Capture failed: network down`);
  });

  it('does not announce a capture that opened a review session — the Note is the receipt', async () => {
    const seen: { kind: string; message: string }[] = [];
    await captureThought('a thought', captureDeps({ online: true, onStatus: (m) => seen.push(m) }));
    expect(seen).toEqual([]);
  });
});

describe('recovery', () => {
  it('organizes an offline Dump on reconnect and dequeues it', async () => {
    await captureThought('I keep forgetting to water the plants', captureDeps({ online: false }));

    const result = await recoverPending(recoverDeps());

    expect(result.failed).toEqual([]);
    expect(result.organized).toHaveLength(1);
    expect(result.organized[0].note.title).toBe('Water the plants');

    // The Dump landed in _dumps/, verbatim, dated by its capture time (not the sync time).
    expect(await contentAt(dumpFile)).toContain('I keep forgetting to water the plants');

    const notePath = 'Brain Dump/2026-08-21-water-the-plants.md';
    expect(await contentAt(notePath)).toContain(`source: [[${dumpFile.replace(/\.md$/, '')}]]`);
    expect((await storedPaths()).sort()).toEqual([notePath, dumpFile].sort());
    expect(await pending.list()).toEqual([]);
  });

  it('recovers a Dump interrupted mid-Organize, once the restart adopts it', async () => {
    // Window A of finding 02: the app died between the Dump write and the preview.
    void captureThought('interrupted', captureDeps({ online: true, organizer: hangingOrganizer }));
    await new Promise((r) => setTimeout(r, 50));

    // The retry timer must not touch it while it may genuinely still be in flight.
    expect((await recoverPending(recoverDeps())).organized).toEqual([]);
    expect(await notePaths()).toEqual([]);

    // A restart: nothing can still be organizing it, so the claim is retired.
    const adopted = await adoptInterrupted(pending);
    expect(adopted.map((r) => r.reason)).toEqual(['interrupted']);

    const result = await recoverPending(recoverDeps());
    expect(result.organized).toHaveLength(1);
    expect(await notePaths()).toEqual(['Brain Dump/2026-08-21-water-the-plants.md']);
    expect(await pending.list()).toEqual([]);
  });

  it('never recovers the Dump the user is reviewing on screen', async () => {
    const outcome = await captureThought('under review', captureDeps({ online: true }));
    if (outcome.kind !== 'session') throw new Error('expected session');
    // Even after a restart adopted it — the session is open in this tab.
    await adoptInterrupted(pending);

    const result = await recoverPending(recoverDeps({ exclude: [outcome.session.dump.id] }));

    expect(result.organized).toEqual([]);
    expect(await notePaths()).toEqual([]);
    expect(await pending.list()).toHaveLength(1);
  });

  it('recovers a Dump that fell back after a failed online capture, without duplicating it', async () => {
    await captureThought('a thought mid-flight', captureDeps({ online: true, db: failingDb }));

    now = fixedNow + RETRY_BACKOFF_MS[0];
    const result = await recoverPending(recoverDeps());

    expect(result.organized).toHaveLength(1);
    expect((await storedPaths()).sort()).toEqual(
      ['Brain Dump/2026-08-21-water-the-plants.md', dumpFile].sort(),
    );
    expect(await pending.list()).toEqual([]);
  });

  it('recovers multiple Dumps in capture order', async () => {
    await captureThought('first', captureDeps({ online: false, id: 'id-one', now: fixedNow }));
    await captureThought(
      'second',
      captureDeps({ online: false, id: 'id-two', now: fixedNow + 60_000 }),
    );

    const result = await recoverPending(recoverDeps());

    expect(result.organized.map((o) => o.dump.content)).toEqual(['first', 'second']);
    expect(await pending.list()).toEqual([]);
  });

  it('does nothing while still offline — the Pending Dump is untouched', async () => {
    await captureThought('still offline', captureDeps({ online: false }));

    const result = await recoverPending(recoverDeps({ isOnline: () => false }));

    expect(result.organized).toEqual([]);
    expect(await storedPaths()).toEqual([]);
    expect(await pending.list()).toHaveLength(1);
  });

  it('organizes the Dump the user actually finished writing, Context included', async () => {
    const outcome = await captureThought('kopi', captureDeps({ online: true }));
    if (outcome.kind !== 'session') throw new Error('expected session');
    await addContext(outcome.session, 'the ones older than a month', {
      db,
      settings,
      hash: sha1Hex,
      pending,
    });

    // The record moved with the Dump, so the recovery does not Organize a stale snapshot.
    const [record] = await pending.list();
    expect(record.dump.context).toBe('the ones older than a month');

    await adoptInterrupted(pending);
    const result = await recoverPending(recoverDeps({ organizer: echoOrganizer }));
    expect(result.organized[0].note.body).toContain('the ones older than a month');
  });

  it('reads the Dump back from the Vault, so Context survives even an un-recorded edit', async () => {
    const outcome = await captureThought('kopi', captureDeps({ online: true }));
    if (outcome.kind !== 'session') throw new Error('expected session');
    // No `pending` in the deps: the Vault got the Context, the record did not — the app
    // died in between. The Vault is the source of truth for the thought itself.
    await addContext(outcome.session, 'the ones older than a month', {
      db,
      settings,
      hash: sha1Hex,
    });

    await adoptInterrupted(pending);
    const result = await recoverPending(recoverDeps({ organizer: echoOrganizer }));

    expect(result.organized[0].note.body).toContain('the ones older than a month');
    // And the Vault's Dump file was not clobbered back to the pre-Context snapshot.
    expect(await contentAt(dumpFile)).toContain('the ones older than a month');
  });
});

describe('the duplicate-Note window', () => {
  it('dequeues a Dump a Note already cites, instead of Organizing it a second time', async () => {
    await captureThought('a thought', captureDeps({ online: false }));

    // The app dies between writing the Note and dequeuing the Dump: the dequeue itself
    // is what fails. The Note is in the Vault; the record still says it is Pending.
    let killed = false;
    const dyingStore: PendingStore = {
      ...pending,
      remove: async (id) => {
        if (!killed) {
          killed = true;
          throw new Error('app closed before the dequeue');
        }
        return pending.remove(id);
      },
    };
    await recoverPending(recoverDeps({ pending: dyingStore }));
    expect(await notePaths()).toEqual(['Brain Dump/2026-08-21-water-the-plants.md']);
    expect(await pending.list()).toHaveLength(1);

    // The next recovery must not write a second Note. It would not overwrite the first:
    // the filename is derived from the LLM's title, and a re-Organize can retitle it.
    const retitling: Organizer = {
      organize: async () => ({ ...sampleOutput, title: 'Watering the plants again' }),
    };
    now = fixedNow + RETRY_BACKOFF_MS[0];
    const result = await recoverPending(recoverDeps({ organizer: retitling }));

    expect(result.organized).toEqual([]);
    expect(result.alreadyOrganized.map((d) => d.content)).toEqual(['a thought']);
    expect(await notePaths()).toEqual(['Brain Dump/2026-08-21-water-the-plants.md']);
    expect(await pending.list()).toEqual([]);
  });

  it('recognises a Dump that was Appended to an existing Note, not just one that founded a Note', async () => {
    await captureThought('a thought', captureDeps({ online: false }));
    // An appended section cites its Dump with `_Source:`, not frontmatter `source:`.
    const { writeFile } = await import('../src/lib/livesync');
    await writeFile(
      db,
      'Brain Dump/2026-08-01-plants.md',
      `---\ntitle: Plants\n---\n\nbody\n\n## Appended 2026-08-21\n\nmore\n\n_Source: [[${dumpFile.replace(/\.md$/, '')}]]_\n`,
      { ctime: fixedNow, mtime: fixedNow, hash: sha1Hex, settings },
    );

    const result = await recoverPending(recoverDeps());

    expect(result.organized).toEqual([]);
    expect(result.alreadyOrganized).toHaveLength(1);
    expect(await notePaths()).toEqual(['Brain Dump/2026-08-01-plants.md']);
  });
});

describe('retry, backoff and giving up', () => {
  it('keeps the Dump Pending when Organize fails, and organizes it once the backoff elapses', async () => {
    await captureThought('a thought', captureDeps({ online: false }));

    let fail = true;
    const flaky: Organizer = {
      organize: async () => {
        if (fail) throw new Error('LLM unavailable');
        return sampleOutput;
      },
    };

    const first = await recoverPending(recoverDeps({ organizer: flaky }));
    expect(first.organized).toEqual([]);
    expect(first.failed).toHaveLength(1);
    const [record] = await pending.list();
    expect(record.attempts).toBe(1);
    expect(record.lastError).toBe('LLM unavailable');
    // No Note yet — but the raw Dump has already been synced, so it is safe in the vault.
    expect(await storedPaths()).toEqual([dumpFile]);

    // Too soon: the backoff is honoured rather than spinning once a minute.
    const tooSoon = await recoverPending(recoverDeps({ organizer: flaky }));
    expect(tooSoon.failed).toEqual([]);
    expect((await pending.list())[0].attempts).toBe(1);

    fail = false;
    now = fixedNow + RETRY_BACKOFF_MS[0];
    const second = await recoverPending(recoverDeps({ organizer: flaky }));
    expect(second.organized).toHaveLength(1);
    expect(await pending.list()).toEqual([]);
  });

  it('retries a Note that failed to save, without waiting for a restart', async () => {
    // The failure the user is actually watching: the preview is on screen and the save
    // throws. It must back off and try again like any other failed attempt.
    const outcome = await captureThought('a thought', captureDeps({ online: true }));
    if (outcome.kind !== 'session') throw new Error('expected session');
    const settled = await settleMatch(outcome.session, { db, settings, matcher: newOnlyMatcher });
    const failed = await finalizeCapture(settled, { ...finalizeDeps(), db: failingDb });
    expect(failed.ok).toBe(false);

    const [record] = await pending.list();
    expect(record.reason).toBe('failed');
    expect(record.attempts).toBe(1);
    expect(record.nextAttemptAt).toBe(fixedNow + RETRY_BACKOFF_MS[0]);

    now = fixedNow + RETRY_BACKOFF_MS[0];
    const result = await recoverPending(recoverDeps());
    expect(result.organized).toHaveLength(1);
    expect(await pending.list()).toEqual([]);
  });

  it('arms only the Stranded Dumps when the user presses Retry, not every Pending one', async () => {
    // Retry-all is offered beside the Stranded line. A Dump that is merely backing off is
    // not Stranded, and throwing away its wait would make a broken provider spin again.
    await pending.save({
      dump: { id: 'out-of-attempts', content: 'gave up', context: '', createdAt: fixedNow, modality: 'text' },
      reason: 'failed',
      enrolledAt: fixedNow,
      attempts: MAX_ORGANIZE_ATTEMPTS,
      lastError: 'Invalid Adapter: undefined',
      nextAttemptAt: fixedNow + RETRY_BACKOFF_MS[0],
    });
    await pending.save({
      dump: { id: 'backing-off', content: 'still trying', context: '', createdAt: fixedNow + 1, modality: 'text' },
      reason: 'failed',
      enrolledAt: fixedNow,
      attempts: 1,
      lastError: 'LLM unavailable',
      nextAttemptAt: fixedNow + RETRY_BACKOFF_MS[0],
    });

    await retryPending(pending);

    const byId = Object.fromEntries((await pending.list()).map((r) => [r.dump.id, r]));
    expect(byId['out-of-attempts'].attempts).toBe(0);
    expect(byId['out-of-attempts'].nextAttemptAt).toBeUndefined();
    expect(byId['backing-off'].attempts).toBe(1);
    expect(byId['backing-off'].nextAttemptAt).toBe(fixedNow + RETRY_BACKOFF_MS[0]);
  });

  it('arms a named Dump even when it is only backing off', async () => {
    // Naming one is an explicit ask, not the blanket Retry-all.
    await captureThought('a thought', captureDeps({ online: false }));
    await recoverPending(recoverDeps({ organizer: { organize: async () => { throw new Error('down'); } } }));
    const [before] = await pending.list();
    expect(before.attempts).toBe(1);

    await retryPending(pending, [before.dump.id]);

    const [after] = await pending.list();
    expect(after.attempts).toBe(0);
    expect(after.nextAttemptAt).toBeUndefined();
  });

  it('stops retrying after the attempt cap and reports the Dump as Stranded', async () => {
    await captureThought('a thought', captureDeps({ online: false }));
    const broken: Organizer = {
      organize: async () => {
        throw new Error('Invalid Adapter: undefined');
      },
    };

    for (let i = 0; i < MAX_ORGANIZE_ATTEMPTS; i++) {
      await recoverPending(recoverDeps({ organizer: broken }));
      now += RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
    }

    const [record] = await pending.list();
    expect(record.attempts).toBe(MAX_ORGANIZE_ATTEMPTS);
    expect(isStranded(record)).toBe(true);
    expect(record.lastError).toBe('Invalid Adapter: undefined');

    // Further recoveries cost nothing: it is not attempted again.
    const after = await recoverPending(recoverDeps({ organizer: broken }));
    expect(after.failed).toEqual([]);
    expect(after.stranded).toHaveLength(1);
    expect((await pending.list())[0].attempts).toBe(MAX_ORGANIZE_ATTEMPTS);

    // Until the user asks — they have usually just fixed what was broken.
    await retryPending(pending);
    const retried = await recoverPending(recoverDeps());
    expect(retried.organized).toHaveLength(1);
    expect(await pending.list()).toEqual([]);
  });
});

describe('Vault reconciliation', () => {
  /** Write a Dump straight into the Vault, as a past session would have left it. */
  async function writeStrandedDump(dump: Dump): Promise<void> {
    const { writeFile } = await import('../src/lib/livesync');
    await writeFile(db, dumpPath(dump, settings), dumpFileContent(dump), {
      ctime: dump.createdAt,
      mtime: dump.createdAt,
      hash: sha1Hex,
      settings,
    });
  }

  const strandedDump: Dump = {
    id: 'f9147700-0000-0000-0000-000000000000',
    content: 'kopi kopi yang udah lama kayak diatas sebulan',
    context: '',
    createdAt: fixedNow,
    modality: 'text',
  };

  it('finds a Dump in the Vault that no Note cites', async () => {
    await writeStrandedDump(strandedDump);

    const stranded = await findStrandedDumps({ db, settings, hash: sha1Hex, pending });

    expect(stranded.map((s) => s.dump.content)).toEqual([strandedDump.content]);
    expect(stranded.map((s) => s.reason)).toEqual(['unfiled']);
  });

  it('ignores a Dump that a Note already cites', async () => {
    await writeStrandedDump(strandedDump);
    await recoverPending({
      ...recoverDeps(),
      pending: {
        ...pending,
        list: async () => [
          { dump: strandedDump, reason: 'offline' as const, enrolledAt: fixedNow, attempts: 0 },
        ],
      },
    });

    expect(await findStrandedDumps({ db, settings, hash: sha1Hex, pending })).toEqual([]);
  });

  it('ignores a Dump the Pending store already knows about', async () => {
    await captureThought('still queued', captureDeps({ online: false }));
    await recoverPending(recoverDeps({ organizer: { organize: async () => { throw new Error('down'); } } }));

    // The Dump reached the Vault but has no Note — and it is not Stranded, because
    // recovery is still working on it.
    expect(await storedPaths()).toEqual([dumpFile]);
    expect(await findStrandedDumps({ db, settings, hash: sha1Hex, pending })).toEqual([]);
  });

  it('reads a Dump back out of its file, Context and all', () => {
    const dump: Dump = { ...strandedDump, context: 'the ones older than a month' };
    // `appended` round-trips too: empty until a capture is Appended (ADR-0009).
    expect(parseDumpFile(dumpFileContent(dump))).toEqual({ ...dump, appended: [] });
    expect(parseDumpFile(dumpFileContent(strandedDump))).toEqual({ ...strandedDump, appended: [] });
    expect(parseDumpFile('not a Dump at all')).toBeNull();
  });
});

describe('durability', () => {
  it('survives an app restart — a fresh store over the same IndexedDB still has the Dump', async () => {
    await captureThought('survive a reload', captureDeps({ online: false }));

    const reopened = createIndexedDbPendingStore();
    const records = await reopened.list();
    expect(records).toHaveLength(1);
    expect(records[0].dump.content).toBe('survive a reload');

    const result = await recoverPending(recoverDeps({ pending: reopened }));
    expect(result.organized).toHaveLength(1);
    expect(await createIndexedDbPendingStore().list()).toEqual([]);
  });

  it('keeps Pending Dumps distinct and removes only the one dequeued', async () => {
    await captureThought('one', captureDeps({ online: false, id: 'id-one' }));
    await captureThought('two', captureDeps({ online: false, id: 'id-two', now: fixedNow + 1000 }));

    await pending.remove('id-one');

    const records = await createIndexedDbPendingStore().list();
    expect(records.map((r) => r.dump.content)).toEqual(['two']);
  });

  it('upgrades a v2 outbox entry rather than dropping the thought', async () => {
    // v2 stored a bare Dump; v3 stores a PendingDump envelope. An entry here is a thought
    // that never became a Note, which is the one thing this store must not lose.
    const bare: Dump = {
      id: 'v2-dump',
      content: 'captured before the upgrade',
      context: '',
      createdAt: fixedNow,
      modality: 'text',
    };
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('brain-dump', 2);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('settings');
        req.result.createObjectStore('outbox');
      };
      req.onsuccess = () => {
        const db2 = req.result;
        const tx = db2.transaction('outbox', 'readwrite');
        tx.objectStore('outbox').put(bare, bare.id);
        tx.oncomplete = () => {
          db2.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    const records = await createIndexedDbPendingStore().list();

    expect(records).toHaveLength(1);
    expect(records[0].dump).toEqual(bare);
    expect(records[0].reason).toBe('offline');
    expect(records[0].attempts).toBe(0);
    expect(records[0].enrolledAt).toBe(fixedNow);
  });
});

// --- Deleted documents (dogfooding finding 04) ---------------------------
// Obsidian LiveSync deletes softly: the document keeps its chunks and gains
// `deleted: true`. Five documents the app had written were removed that way, and the
// app could not see it — so a Dump whose Note had been deleted looked filed, and
// Retrieve would still answer from the deleted Note.
describe('deleted documents', () => {
  const strandedDump: Dump = {
    id: '7d88b526-c399-422e-8538-60741ccb885a',
    content: 'semekar adenium di grind 0.4 nyangkut banget',
    context: '',
    createdAt: fixedNow,
    modality: 'text',
  };

  /** Write a file, then soft-delete it the way LiveSync does. */
  async function writeAndDelete(path: string, content: string): Promise<void> {
    const { writeFile, docIdForPath } = await import('../src/lib/livesync');
    await writeFile(db, path, content, { ctime: fixedNow, mtime: fixedNow, hash: sha1Hex, settings });
    const doc = await db.get<Record<string, unknown>>(docIdForPath(path, settings));
    await db.put({ ...doc, deleted: true });
  }

  async function writeDumpFile(dump: Dump): Promise<void> {
    const { writeFile } = await import('../src/lib/livesync');
    await writeFile(db, dumpPath(dump, settings), dumpFileContent(dump), {
      ctime: dump.createdAt, mtime: dump.createdAt, hash: sha1Hex, settings,
    });
  }

  /** A Note citing `dump`, written then soft-deleted. */
  async function writeAndDeleteNoteFor(dump: Dump, notePath: string): Promise<void> {
    await writeAndDelete(
      notePath,
      `---\ntitle: A Note\nsource: ${sourceWikilink(dump, settings)}\n---\n\nbody\n`,
    );
  }

  it('reports a Dump whose Note was deleted, and says so', async () => {
    await writeDumpFile(strandedDump);
    await writeAndDeleteNoteFor(strandedDump, 'Brain Dump/2026-08-21-a-note.md');

    const stranded = await findStrandedDumps({ db, settings, hash: sha1Hex });

    expect(stranded).toHaveLength(1);
    expect(stranded[0].reason).toBe('note-deleted');
    expect(stranded[0].notePath).toBe('Brain Dump/2026-08-21-a-note.md');
    expect(stranded[0].dump.content).toContain('semekar');
  });

  it('reports a Dump that was itself deleted, rather than letting it vanish', async () => {
    await writeAndDelete(dumpPath(strandedDump, settings), dumpFileContent(strandedDump));
    await writeAndDeleteNoteFor(strandedDump, 'Brain Dump/2026-08-21-a-note.md');

    const stranded = await findStrandedDumps({ db, settings, hash: sha1Hex });

    expect(stranded).toHaveLength(1);
    expect(stranded[0].reason).toBe('dump-deleted');
    // The thought is still readable — a soft delete keeps the chunks.
    expect(stranded[0].dump.content).toContain('semekar');
  });

  it('still calls a Dump with no Note at all unfiled', async () => {
    await writeDumpFile(strandedDump);

    const stranded = await findStrandedDumps({ db, settings, hash: sha1Hex });

    expect(stranded).toHaveLength(1);
    expect(stranded[0].reason).toBe('unfiled');
  });

  it('does not report a Dump whose Note is alive', async () => {
    await writeDumpFile(strandedDump);
    const { writeFile } = await import('../src/lib/livesync');
    await writeFile(
      db,
      'Brain Dump/2026-08-21-a-note.md',
      `---\ntitle: A Note\nsource: ${sourceWikilink(strandedDump, settings)}\n---\n\nbody\n`,
      { ctime: fixedNow, mtime: fixedNow, hash: sha1Hex, settings },
    );

    expect(await findStrandedDumps({ db, settings, hash: sha1Hex })).toEqual([]);
  });

  it('keeps deleted Notes out of everything else — Retrieve must not cite one', async () => {
    const { readVaultFiles } = await import('../src/lib/livesync');
    await writeAndDelete('Brain Dump/2026-08-21-deleted.md', 'a deleted Note');
    const { writeFile } = await import('../src/lib/livesync');
    await writeFile(db, 'Brain Dump/2026-08-21-live.md', 'a live Note', {
      ctime: fixedNow, mtime: fixedNow, hash: sha1Hex, settings,
    });

    const visible = await readVaultFiles(db, () => true);
    expect(visible.map((f) => f.path)).toEqual(['Brain Dump/2026-08-21-live.md']);

    // Reconciliation is the one caller that must see them.
    const all = await readVaultFiles(db, () => true, { includeDeleted: true });
    expect(all.map((f) => f.path).sort()).toEqual([
      'Brain Dump/2026-08-21-deleted.md',
      'Brain Dump/2026-08-21-live.md',
    ]);
    expect(all.find((f) => f.path.endsWith('deleted.md'))?.deleted).toBe(true);
  });

  it('restores a soft-deleted document, chunks and all', async () => {
    const { readVaultFiles } = await import('../src/lib/livesync');
    await writeAndDelete(dumpPath(strandedDump, settings), dumpFileContent(strandedDump));
    await writeAndDeleteNoteFor(strandedDump, 'Brain Dump/2026-08-21-a-note.md');

    await restoreStranded(
      { dump: strandedDump, reason: 'dump-deleted', notePath: 'Brain Dump/2026-08-21-a-note.md' },
      { db, settings, hash: sha1Hex },
    );

    const live = (await readVaultFiles(db, () => true)).map((f) => f.path).sort();
    expect(live).toEqual(['Brain Dump/2026-08-21-a-note.md', dumpPath(strandedDump, settings)].sort());
    expect(await findStrandedDumps({ db, settings, hash: sha1Hex })).toEqual([]);
  });

  it('stops reporting a Dump the user dismissed, without touching the Vault', async () => {
    await writeDumpFile(strandedDump);
    const dismissed = createIndexedDbDismissedStore();

    await dismissed.dismiss(strandedDump.id);

    expect(await findStrandedDumps({ db, settings, hash: sha1Hex, dismissed })).toEqual([]);
    // Dismissing is a note-to-self, not an edit: the Dump is untouched and still readable.
    const { readVaultFiles } = await import('../src/lib/livesync');
    expect(await readVaultFiles(db, () => true)).toHaveLength(1);
    // And it survives a restart.
    expect(await createIndexedDbDismissedStore().list()).toEqual([strandedDump.id]);
  });
});

// --- Dismissed Dumps (ticket 08: the Settings sheet lists them and can restore them) -------
// Dismissing is a note to self that writes nothing to the Vault (CONTEXT.md: Dismissed); the
// Dump stays exactly where it is and is simply held out of the Stranded list by `deriveStranded`'s
// dismissed-id exclusion. `findDismissedDumps` inverts that exclusion: it lists the Dumps the user
// dismissed, with the reason each was stranded for, so the Settings sheet can show them and offer
// Restore. Restoring is the mirror of dismissing — it removes the id from the dismissed set, so the
// next reconcile no longer excludes it: the Dump returns to the Stranded band.
describe('dismissed Dumps — listed and restored (ticket 08)', () => {
  const older: Dump = {
    id: '7d88b526-c399-422e-8538-60741ccb885a',
    content: 'semekar adenium di grind 0.4 nyangkut banget',
    context: '',
    createdAt: fixedNow,
    modality: 'text',
  };
  const newer: Dump = {
    id: '22222222-3333-4444-5555-666666666666',
    content: 'a second thought that also came to nothing',
    context: '',
    createdAt: fixedNow + 60_000,
    modality: 'text',
  };

  async function writeDumpFile(dump: Dump): Promise<void> {
    const { writeFile } = await import('../src/lib/livesync');
    await writeFile(db, dumpPath(dump, settings), dumpFileContent(dump), {
      ctime: dump.createdAt, mtime: dump.createdAt, hash: sha1Hex, settings,
    });
  }

  it('lists the Dumps the user dismissed, with the reason each was stranded for, oldest first', async () => {
    await writeDumpFile(older);
    await writeDumpFile(newer);
    const dismissed = createIndexedDbDismissedStore();
    await dismissed.dismiss(newer.id);
    await dismissed.dismiss(older.id);

    const list = await findDismissedDumps({ db, settings, hash: sha1Hex, dismissed });

    // Oldest capture first — the same order the Stranded band uses — and each carries the
    // reason it would be stranded for, so the user can tell what restoring would return to.
    expect(list).toHaveLength(2);
    expect(list.map((s) => s.dump.id)).toEqual([older.id, newer.id]);
    expect(list[0].reason).toBe('unfiled');
    expect(list[1].reason).toBe('unfiled');
  });

  it('keeps a still-stranded Dump the user has not dismissed out of the Dismissed list', async () => {
    await writeDumpFile(older);
    const dismissed = createIndexedDbDismissedStore();
    // Nothing dismissed — older is stranded but not dismissed.

    expect(await findDismissedDumps({ db, settings, hash: sha1Hex, dismissed })).toEqual([]);
    // The same Dump is, of course, still stranded: the Dismissed list is not the Stranded list.
    expect(await findStrandedDumps({ db, settings, hash: sha1Hex, dismissed })).toHaveLength(1);
  });

  it('does not list a Dismissed Dump a live Note has since cited — it was filed after the dismissal', async () => {
    await writeDumpFile(older);
    const dismissed = createIndexedDbDismissedStore();
    await dismissed.dismiss(older.id);
    // The Dump gets filed after the dismissal — a live Note now cites it.
    const { writeFile } = await import('../src/lib/livesync');
    await writeFile(
      db,
      'Brain Dump/2026-08-21-filed.md',
      `---\ntitle: A Note\nsource: ${sourceWikilink(older, settings)}\n---\n\nbody\n`,
      { ctime: fixedNow, mtime: fixedNow, hash: sha1Hex, settings },
    );

    // It is no longer stranded-shaped, so it has no place in the Dismissed list even though the
    // dismissed set still holds a stale id: restoring it would strand nothing.
    expect(await findDismissedDumps({ db, settings, hash: sha1Hex, dismissed })).toEqual([]);
  });

  it('restoring a Dismissed Dump returns it to the Stranded band, and takes it off the Dismissed list', async () => {
    await writeDumpFile(older);
    const dismissed = createIndexedDbDismissedStore();
    await dismissed.dismiss(older.id);

    // Dismissed: held out of Stranded, shown as Dismissed.
    expect(await findStrandedDumps({ db, settings, hash: sha1Hex, dismissed })).toEqual([]);
    expect(await findDismissedDumps({ db, settings, hash: sha1Hex, dismissed })).toHaveLength(1);

    // Restore — the mirror of dismiss: the id leaves the dismissed set, so the next reconcile
    // no longer excludes it. The Dump is back on the Stranded band and off the Dismissed list.
    await dismissed.restore(older.id);
    expect(await findStrandedDumps({ db, settings, hash: sha1Hex, dismissed })).toHaveLength(1);
    expect(await findDismissedDumps({ db, settings, hash: sha1Hex, dismissed })).toEqual([]);
  });
});

describe('recovery computes Related (capture-latency ticket 05)', () => {
  // One dimension per topic word, as in related.test.ts: similarity is exact topic overlap,
  // so the test decides precisely which documents are close to the recovered Note.
  const TOPICS = ['plants', 'taxes'];
  const embedder: Embedder = {
    embed: async (texts) =>
      texts.map((t) => TOPICS.map((topic) => (t.toLowerCase().includes(topic) ? 1 : 0))),
  };
  let judged: number;
  const acceptAll: Relater = {
    related: async (_subject, candidates) => {
      judged += 1;
      return candidates.map((_, i) => i);
    },
  };

  /** Seed an existing Note about plants, so the recovered Note has something to link to.
   *  A different title from the organizer's output: same title and day would derive the
   *  same path, and the seed would be excluded as the Note itself. */
  async function seedPlantsNote(): Promise<string> {
    return (
      await writeNote(
        {
          ...sampleOutput,
          title: 'Plants on the windowsill',
          createdAt: fixedNow,
          modality: 'text' as Modality,
          source: '[[_dumps/20260821-000000-zzzzzz]]',
        },
        db,
        settings,
        sha1Hex,
      )
    ).path;
  }

  /** An offline capture — the Pending Dump recovery exists for. */
  async function offlineCapture(text = 'I keep forgetting to water the plants') {
    const outcome = await captureThought(text, captureDeps({ online: false }));
    if (outcome.kind !== 'pending') throw new Error('expected a pending capture');
    return outcome;
  }

  beforeEach(() => {
    judged = 0;
  });

  it('a Note founded by recovery carries Related links that point at documents in the vault', async () => {
    const seeded = await seedPlantsNote();
    const capture = await offlineCapture();
    const link = `[[${seeded.replace(/\.md$/, '')}]]`;

    const result = await recoverPending(recoverDeps({ embedder, relater: acceptAll }));

    expect(result.organized).toHaveLength(1);
    const organized = result.organized[0];
    expect(organized.note.related).toContain(link);
    // The written file carries them too — asserted on what landed, not what was returned.
    const content = await contentAt(organized.noteWrite.path);
    expect(content).toContain('## Related');
    expect(content).toContain(`- ${link}`);
    // The dead-link guarantee holds on the recovery path as well.
    expect(content).not.toContain('- [[plants]]'); // the organizer's invented link is not what landed
  });

  it('no embedder or judge — the Note still files, with an empty section, and the Dump leaves Pending', async () => {
    await offlineCapture();

    const result = await recoverPending(recoverDeps());

    expect(result.organized).toHaveLength(1);
    expect(judged).toBe(0);
    expect(await contentAt(result.organized[0].noteWrite.path)).not.toContain('- [[');
    expect(await pending.list()).toEqual([]);
  });

  it('a Relater that rejects still files the Note, and the Dump does not stay Pending', async () => {
    await seedPlantsNote();
    await offlineCapture();
    const broken: Relater = {
      related: async () => {
        throw new Error('provider down');
      },
    };

    const result = await recoverPending(recoverDeps({ embedder, relater: broken }));

    // Losing the links is far better than losing the Note — and recovery must not gain a
    // new way to strand a Dump (the failure this ticket could introduce).
    expect(result.organized).toHaveLength(1);
    expect(result.failed).toEqual([]);
    expect(await contentAt(result.organized[0].noteWrite.path)).not.toContain('- [[');
    expect(await pending.list()).toEqual([]);
  });
});

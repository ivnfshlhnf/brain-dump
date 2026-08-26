// Seam A — the home grid's projection and its device-local cache, tested as black boxes
// through the operation layer. CouchDB is the in-memory PouchDB stand-in; the card cache is
// the real IndexedDB implementation driven against fake-indexeddb, so durability is asserted
// on real IndexedDB semantics — the same discipline tests/pending.test.ts uses.
//
// The grid paints from this projection; the view has no seam of its own (ADR-0007), so what is
// checkable about the grid lives here.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import PouchDB from 'pouchdb-core';
import memory from 'pouchdb-adapter-memory';
import {
  readVaultForGrid,
  readGrid,
  findStrandedDumps,
  dumpPath,
  dumpFileContent,
  sourceWikilink,
} from '../src/lib/operations';
import { writeFile, readVaultFiles } from '../src/lib/livesync';
import { createIndexedDbCardCache } from '../src/lib/card-cache';
import {
  DEFAULT_SETTINGS,
  type Settings,
  type DocStore,
  type Dump,
  type NoteCard,
  type NoteCardCache,
  type PendingStore,
  type DismissedStore,
  type StrandedDump,
} from '../src/lib/types';

PouchDB.plugin(memory);

const sha1Hex = (c: string) => Promise.resolve(createHash('sha1').update(c).digest('hex'));
const fixedNow = Date.UTC(2026, 7, 21, 20, 30, 45); // 2026-08-21 20:30:45 UTC
const settings: Settings = { ...DEFAULT_SETTINGS, dumpsFolder: '_dumps', managedFolder: 'Brain Dump' };

let db: DocStore;
let seq = 0;

beforeEach(() => {
  db = new PouchDB('cards' + seq++, { adapter: 'memory' }) as unknown as DocStore;
  // A fresh IndexedDB per test — fake-indexeddb keeps one global factory otherwise.
  globalThis.indexedDB = new IDBFactory();
});

const deps = () => ({ db, settings, hash: sha1Hex });

/** Write a Note file into the managed folder with v1 frontmatter. */
async function seedNote(
  path: string,
  fm: Partial<{ title: string; tags: string[]; category: string; summary: string; created: number }> = {},
): Promise<void> {
  const title = fm.title ?? 'A note';
  const tags = fm.tags ?? ['home'];
  const created = fm.created ?? fixedNow;
  const content = `---
title: ${title}
tags: [${tags.join(', ')}]
created: ${created}
modality: text
source: [[_dumps/x]]
category: ${fm.category ?? 'home'}
summary: ${fm.summary ?? 'A summary.'}
---

body
`;
  await writeFile(db, path, content, { ctime: created, mtime: created, hash: sha1Hex, settings });
}

/** Write a file then soft-delete it the way LiveSync does. */
async function writeAndDelete(path: string, content: string): Promise<void> {
  await writeFile(db, path, content, { ctime: fixedNow, mtime: fixedNow, hash: sha1Hex, settings });
  const { docIdForPath } = await import('../src/lib/livesync');
  const doc = await db.get<Record<string, unknown>>(docIdForPath(path, settings));
  await db.put({ ...doc, deleted: true });
}

/** Write a Dump into the Vault's dumps folder, as a past session would have left it. */
async function seedDump(dump: Dump): Promise<void> {
  await writeFile(db, dumpPath(dump, settings), dumpFileContent(dump), {
    ctime: dump.createdAt,
    mtime: dump.createdAt,
    hash: sha1Hex,
    settings,
  });
}

const dump = (id: string, content: string, createdAt = fixedNow): Dump => ({
  id, content, context: '', createdAt, modality: 'text',
});

/** A Pending store holding the given Dumps — only `list` is read by the grid. */
const pendingStore = (dumps: Dump[] = []): PendingStore => {
  const records = dumps.map((d) => ({
    dump: d, reason: 'offline' as const, enrolledAt: d.createdAt, attempts: 0,
  }));
  return {
    save: async () => {}, get: async () => undefined, list: async () => records, remove: async () => {},
  };
};

/** A Dismissed store holding the given ids — only `list` is read by the grid. */
const dismissedStore = (ids: string[] = []): DismissedStore => ({
  dismiss: async () => {}, list: async () => ids, restore: async () => {},
});

/** Grid deps over the shared PouchDB, the real IndexedDB cache, and optional device-local stores. */
const gridDeps = (cache?: NoteCardCache, pending?: PendingStore, dismissed?: DismissedStore) => ({
  db, settings, hash: sha1Hex, ...(cache ? { cache } : {}),
  ...(pending ? { pending } : {}),
  ...(dismissed ? { dismissed } : {}),
});

describe('readGrid — the Note projection (cold path, Seam A)', () => {
  it('returns a card for every Note in the managed folder, with the frontmatter fields', async () => {
    await seedNote('Brain Dump/2026-08-21-water-the-plants.md', {
      title: 'Water the plants',
      tags: ['home', 'plants'],
      category: 'Home',
      summary: 'A reminder to water the plants.',
      created: fixedNow,
    });

    const { cards } = await readGrid(gridDeps());

    expect(cards).toHaveLength(1);
    expect(cards[0]).toEqual<NoteCard>({
      path: 'Brain Dump/2026-08-21-water-the-plants.md',
      title: 'Water the plants',
      category: 'Home',
      summary: 'A reminder to water the plants.',
      tags: ['home', 'plants'],
      createdAt: fixedNow,
    });
  });

  it('excludes Dumps, personal notes, and soft-deleted Notes from the cards', async () => {
    // A live Note — the one card that should appear.
    await seedNote('Brain Dump/2026-08-21-live.md', { title: 'Live' });
    // A Dump in the dumps folder — not a Note (it will surface as Stranded, not as a card).
    await writeFile(db, '_dumps/20260821-203045-aaaaaa.md', '---\nid: x\ncreated: 1\n---\n\n## Original\n\nraw', {
      ctime: fixedNow, mtime: fixedNow, hash: sha1Hex, settings,
    });
    // A personal note outside the managed folder — readable, but not the app's to list.
    await writeFile(db, 'personal/garden.md', '---\ntitle: Garden\n---\n\nmy basil', {
      ctime: fixedNow, mtime: fixedNow, hash: sha1Hex, settings,
    });
    // A Note that was soft-deleted by Obsidian's own sync (finding 04) — gone to the user.
    await writeAndDelete(
      'Brain Dump/2026-08-21-deleted.md',
      `---\ntitle: Deleted\nsummary: gone\n---\n\nbody`,
    );

    const { cards } = await readGrid(gridDeps());

    expect(cards.map((c) => c.path)).toEqual(['Brain Dump/2026-08-21-live.md']);
    // And the deleted Note really is deleted, not merely hidden from the default read.
    const all = await readVaultFiles(db, () => true, { includeDeleted: true });
    expect(all.find((f) => f.path.endsWith('deleted.md'))?.deleted).toBe(true);
  });

  it('lists Notes newest-first', async () => {
    await seedNote('Brain Dump/2026-08-01-old.md', { title: 'Old', created: fixedNow });
    await seedNote('Brain Dump/2026-08-21-new.md', { title: 'New', created: fixedNow + 60_000 });

    const { cards } = await readGrid(gridDeps());

    expect(cards.map((c) => c.title)).toEqual(['New', 'Old']);
  });
});

describe('readVaultForGrid — one pass yields cards and Stranded (ADR-0007)', () => {
  it('returns the Note cards and the Stranded Dumps from a single Vault read', async () => {
    await seedNote('Brain Dump/2026-08-21-plants.md', { title: 'Water the plants' });
    await seedDump(dump('aaaaaaaa', 'kopi yang udah sebulan'));

    const { cards, stranded } = await readVaultForGrid(deps(), new Set(), new Set());

    expect(cards.map((c) => c.title)).toEqual(['Water the plants']);
    expect(stranded).toHaveLength(1);
    expect(stranded[0].dump.content).toBe('kopi yang udah sebulan');
    expect(stranded[0].reason).toBe('unfiled');
  });
});

describe('readGrid — cache-first, one pass reconciles cards and Stranded (ADR-0007)', () => {
  it('cold cache: one Vault pass fills cards and Stranded, writes the cache, no early paint', async () => {
    await seedNote('Brain Dump/2026-08-21-plants.md', { title: 'Water the plants' });
    await seedDump(dump('aaaaaaaa', 'kopi yang udah sebulan'));
    const cache = createIndexedDbCardCache();
    expect(await cache.list()).toEqual([]); // cold
    const painted: NoteCard[][] = [];

    const result = await readGrid(gridDeps(cache), (c) => painted.push(c));

    expect(painted).toEqual([]); // nothing cached, so no early paint
    expect(result.cards.map((c) => c.title)).toEqual(['Water the plants']);
    expect(result.stranded.map((s) => s.dump.id)).toEqual(['aaaaaaaa']);
    // The cold read filled the cache, so a fresh handle paints warm next time.
    expect((await createIndexedDbCardCache().list()).map((c) => c.title)).toEqual(['Water the plants']);
  });

  it('warm cache: paints the cached cards before the pass, then reconciles to the Vault', async () => {
    await seedNote('Brain Dump/2026-08-21-real.md', { title: 'Real' });
    await seedDump(dump('bbbbbbbb', 'a thought left stranded'));
    const cache = createIndexedDbCardCache();
    // Seed a phantom card the Vault does not hold — the early paint shows it, then the reconcile
    // replaces it with the authoritative cards.
    await cache.write([
      { path: 'Brain Dump/phantom.md', title: 'Phantom', category: 'x', summary: '', tags: [], createdAt: fixedNow },
    ]);
    const painted: NoteCard[][] = [];

    const result = await readGrid(gridDeps(cache), (c) => painted.push(c));

    // The cached phantom was painted before the Vault read completed.
    expect(painted.map((cs) => cs.map((c) => c.title))).toEqual([['Phantom']]);
    // The reconcile replaced the phantom with the real Note, and surfaced the Stranded Dump.
    expect(result.cards.map((c) => c.title)).toEqual(['Real']);
    expect(result.stranded.map((s) => s.dump.id)).toEqual(['bbbbbbbb']);
    // The cache was refreshed to the authoritative cards — no stale phantom survives.
    expect((await createIndexedDbCardCache().list()).map((c) => c.title)).toEqual(['Real']);
  });

  it('warm cache + Vault read failure: keeps the painted cached cards, returns no Stranded, does not throw', async () => {
    const cache = createIndexedDbCardCache();
    await cache.write([
      { path: 'Brain Dump/cached.md', title: 'Cached', category: 'x', summary: '', tags: [], createdAt: fixedNow },
    ]);
    const unreachable: DocStore = {
      put: async () => { throw new Error('Vault unreachable'); },
      get: async () => { throw new Error('Vault unreachable'); },
      allDocs: async () => { throw new Error('Vault unreachable'); },
    };
    const painted: NoteCard[][] = [];

    // The Vault read fails. The grid must not throw, and must keep the cards the paint already
    // showed — the cache is the paint-before-the-read, and a Vault outage must not blank the grid.
    const result = await readGrid({ db: unreachable, settings, hash: sha1Hex, cache }, (c) => painted.push(c));

    expect(painted.map((cs) => cs.map((c) => c.title))).toEqual([['Cached']]); // painted first
    expect(result.cards.map((c) => c.title)).toEqual(['Cached']); // kept, not blanked
    expect(result.stranded).toEqual([]); // unknown this open — no throw
  });

  it('a failed cache never blocks — readGrid falls through to the Vault rather than throwing', async () => {
    await seedNote('Brain Dump/2026-08-21-resilient.md', { title: 'Resilient' });
    const broken: NoteCardCache = {
      list: async () => { throw new Error('IndexedDB unreadable'); },
      write: async () => { throw new Error('IndexedDB unwritable'); },
    };
    const painted: NoteCard[][] = [];

    const result = await readGrid(gridDeps(broken), (c) => painted.push(c));

    expect(painted).toEqual([]); // the broken cache was bypassed, so no early paint
    expect(result.cards.map((c) => c.title)).toEqual(['Resilient']);
  });

  it('survives a restart — a fresh cache handle over the same IndexedDB still has the cards', async () => {
    await seedNote('Brain Dump/2026-08-21-keep.md', { title: 'Keep' });
    await readGrid(gridDeps(createIndexedDbCardCache()));

    const reopened = createIndexedDbCardCache(); // a reloaded tab opens a fresh handle
    const result = await readGrid(gridDeps(reopened));

    expect(result.cards.map((c) => c.title)).toEqual(['Keep']);
  });

  it('Stranded deep-equals findStrandedDumps for the same Vault, including notePath and sort (#10)', async () => {
    // An unfiled Dump — never became a Note.
    await seedDump(dump('unfiled', 'never filed', fixedNow));
    // A second Dump that a live Note cites — filed, so not Stranded. Built with the real
    // source wikilink so the citation actually resolves.
    const filed = dump('filed', 'this one has a Note', fixedNow + 1000);
    await seedDump(filed);
    await writeFile(
      db, 'Brain Dump/2026-08-21-cites.md',
      `---\ntitle: Cites filed\ntags: [home]\ncreated: ${fixedNow + 2000}\nmodality: text\nsource: ${sourceWikilink(filed, settings)}\ncategory: home\nsummary: cites\n---\n\nbody`,
      { ctime: fixedNow + 2000, mtime: fixedNow + 2000, hash: sha1Hex, settings },
    );
    // A Note deleted by Obsidian's sync — its Dump surfaces as note-deleted with notePath.
    const orphaned = dump('orphaned', 'my Note was deleted', fixedNow + 3000);
    await seedDump(orphaned);
    await writeAndDelete(
      'Brain Dump/2026-08-21-deleted.md',
      `---\ntitle: Deleted\ntags: [home]\ncreated: ${fixedNow + 4000}\nmodality: text\nsource: ${sourceWikilink(orphaned, settings)}\ncategory: home\nsummary: gone\n---\n\nbody`,
    );

    const grid = await readGrid(gridDeps());
    const settingsReconcile = await findStrandedDumps({ db, settings, hash: sha1Hex });

    // The grid's Stranded list is the same list the Settings reconcile produces, down to reason
    // and notePath, in the same oldest-first order — the unfiled and the note-deleted Dump, the
    // filed one absent.
    expect(grid.stranded.map((s) => s.dump.id)).toEqual(['unfiled', 'orphaned']);
    expect(grid.stranded).toEqual(settingsReconcile);
  });

  it('excludes Dumps already Pending or Dismissed from the grid Stranded list (#8)', async () => {
    const pending = dump('pending-one', 'captured, not yet a Note');
    const dismissed = dump('dismissed-one', 'the user chose to stop hearing about this');
    await seedDump(pending);
    await seedDump(dismissed);

    const result = await readGrid(
      gridDeps(createIndexedDbCardCache(), pendingStore([pending]), dismissedStore([dismissed.id])),
    );

    expect(result.stranded.map((s) => s.dump.id)).toEqual([]);
  });

  it('surfaces a Dump whose Note Obsidian deleted as Stranded with note-deleted + notePath (#9)', async () => {
    const orphan = dump('orphan', 'my Note was deleted');
    await seedDump(orphan);
    await writeAndDelete(
      'Brain Dump/2026-08-21-gone.md',
      `---\ntitle: Gone\ntags: [home]\ncreated: ${fixedNow}\nmodality: text\nsource: ${sourceWikilink(orphan, settings)}\ncategory: home\nsummary: gone\n---\n\nbody`,
    );

    const result = await readGrid(gridDeps());

    expect(result.stranded).toHaveLength(1);
    expect(result.stranded[0].reason).toBe('note-deleted');
    expect(result.stranded[0].notePath).toBe('Brain Dump/2026-08-21-gone.md');
  });
});
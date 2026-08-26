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
import { listNotes, listCards, refreshCards } from '../src/lib/operations';
import { writeFile, readVaultFiles } from '../src/lib/livesync';
import { createIndexedDbCardCache } from '../src/lib/card-cache';
import {
  DEFAULT_SETTINGS,
  type Settings,
  type DocStore,
  type NoteCard,
  type NoteCardCache,
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

describe('listNotes — the grid projection (Seam A)', () => {
  it('returns a card for every Note in the managed folder, with the frontmatter fields', async () => {
    await seedNote('Brain Dump/2026-08-21-water-the-plants.md', {
      title: 'Water the plants',
      tags: ['home', 'plants'],
      category: 'Home',
      summary: 'A reminder to water the plants.',
      created: fixedNow,
    });

    const cards = await listNotes(deps());

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

  it('excludes Dumps, personal notes, and soft-deleted Notes', async () => {
    // A live Note — the one card that should appear.
    await seedNote('Brain Dump/2026-08-21-live.md', { title: 'Live' });
    // A Dump in the dumps folder — not a Note.
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

    const cards = await listNotes(deps());

    expect(cards.map((c) => c.path)).toEqual(['Brain Dump/2026-08-21-live.md']);
    // And the deleted Note really is deleted, not merely hidden from the default read.
    const all = await readVaultFiles(db, () => true, { includeDeleted: true });
    expect(all.find((f) => f.path.endsWith('deleted.md'))?.deleted).toBe(true);
  });

  it('lists Notes newest-first', async () => {
    await seedNote('Brain Dump/2026-08-01-old.md', { title: 'Old', created: fixedNow });
    await seedNote('Brain Dump/2026-08-21-new.md', { title: 'New', created: fixedNow + 60_000 });

    const cards = await listNotes(deps());

    expect(cards.map((c) => c.title)).toEqual(['New', 'Old']);
  });
});

describe('the card cache (Seam A — ADR-0007)', () => {
  const cardDeps = (cache?: NoteCardCache) => ({ db, settings, hash: sha1Hex, ...(cache ? { cache } : {}) });

  it('paints from the cache without reading the Vault, when the cache holds cards', async () => {
    await seedNote('Brain Dump/2026-08-21-real.md', { title: 'Real' });
    const cache = createIndexedDbCardCache();
    // Seed the cache with a card that is NOT in the Vault. If listCards read the Vault it would
    // return only "Real"; returning the cached phantom proves it painted from the cache.
    await cache.write([
      { path: 'Brain Dump/phantom.md', title: 'Phantom', category: 'x', summary: '', tags: [], createdAt: fixedNow },
    ]);

    const result = await listCards(cardDeps(cache));

    expect(result.cards.map((c) => c.title)).toEqual(['Phantom']);
    expect(result.fromCache).toBe(true); // painted from the cache, not the Vault
  });

  it('survives a restart — a fresh store over the same IndexedDB still has the cards', async () => {
    await seedNote('Brain Dump/2026-08-21-keep.md', { title: 'Keep' });
    await refreshCards(cardDeps(createIndexedDbCardCache()));

    // A new store handle, as a reloaded tab would open: the cache is shared IndexedDB, not memory.
    const reopened = createIndexedDbCardCache();
    const cached = await reopened.list();

    expect(cached.map((c) => c.title)).toEqual(['Keep']);
  });

  it('is rebuilt from the Vault when absent, and filled for next time', async () => {
    await seedNote('Brain Dump/2026-08-21-rebuild.md', { title: 'Rebuild' });
    const cache = createIndexedDbCardCache();
    expect(await cache.list()).toEqual([]); // cold cache

    const result = await listCards(cardDeps(cache));

    expect(result.cards.map((c) => c.title)).toEqual(['Rebuild']);
    expect(result.fromCache).toBe(false); // cold cache — read the Vault, then filled the cache
    // The read filled the cache, so a subsequent open paints without hitting the Vault.
    expect((await createIndexedDbCardCache().list()).map((c) => c.title)).toEqual(['Rebuild']);
  });

  it('a failed cache never blocks — listCards falls through to the Vault rather than throwing', async () => {
    await seedNote('Brain Dump/2026-08-21-resilient.md', { title: 'Resilient' });
    const broken: NoteCardCache = {
      list: async () => { throw new Error('IndexedDB unreadable'); },
      write: async () => { throw new Error('IndexedDB unwritable'); },
    };

    // The Capture control lives on the grid, so a broken cache must not take the grid down with
    // it. The Vault is the source of truth; the cache is disposable.
    const result = await listCards(cardDeps(broken));

    expect(result.cards.map((c) => c.title)).toEqual(['Resilient']);
    expect(result.fromCache).toBe(false); // the broken cache was bypassed for the Vault read
  });
});
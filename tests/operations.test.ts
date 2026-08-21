// Seam A — application operations, tested as black boxes.
// CouchDB is an in-memory PouchDB; the LLM/embedder is irrelevant to capture (no LLM in ticket 01).
import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import PouchDB from 'pouchdb-core';
import memory from 'pouchdb-adapter-memory';
import { capture } from '../src/lib/operations';
import { docIdForPath, writeFile } from '../src/lib/livesync';
import { DEFAULT_SETTINGS, type Settings, type DocStore } from '../src/lib/types';

PouchDB.plugin(memory);

function sha1Hex(content: string): Promise<string> {
  return Promise.resolve(createHash('sha1').update(content).digest('hex'));
}

const fixedNow = Date.UTC(2026, 7, 21, 20, 30, 45); // 2026-08-21 20:30:45 UTC
const fixedId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const settings: Settings = { ...DEFAULT_SETTINGS, dumpsFolder: '_dumps', managedFolder: 'Brain Dump' };

let db: DocStore;
let seq = 0;

const depsWithId = (id: string) => ({
  db,
  settings,
  now: () => fixedNow,
  newId: () => id,
  hash: sha1Hex,
});

beforeEach(() => {
  // Fresh in-memory DB per test (the memory adapter shares state by name within a process).
  db = new PouchDB('t' + seq++, { adapter: 'memory' }) as unknown as DocStore;
});

describe('capture (Seam A)', () => {
  it('saves a verbatim Dump to _dumps/ as a metadata doc + a content-addressed chunk doc', async () => {
    const result = await capture('I keep forgetting to water the plants', depsWithId(fixedId));

    expect(result.path.startsWith('_dumps/')).toBe(true);

    const meta = await db.get<{ type: string; path: string; children: string[]; eden: object }>(
      result.metadataId,
    );
    expect(meta.type).toBe('plain');
    expect(meta.path).toBe(result.path);
    expect(meta.children).toHaveLength(1);
    expect(meta.eden).toEqual({});

    const chunk = await db.get<{ type: string; data: string; _id: string }>(meta.children[0]);
    expect(chunk.type).toBe('leaf');
    expect(chunk.data).toContain('I keep forgetting to water the plants');
    expect(chunk._id).toBe('h:' + createHash('sha1').update(chunk.data).digest('hex'));
  });

  it('uses a lowercased _id with the /_dumps/ prefix (case-insensitive default)', async () => {
    const result = await capture('a thought', depsWithId(fixedId));
    expect(result.metadataId).toBe('/_dumps/20260821-203045-aaaaaa.md');
  });

  it('preserves the verbatim text inside the dump file', async () => {
    const result = await capture('exact words here 123', depsWithId(fixedId));
    const meta = await db.get<{ children: string[] }>(result.metadataId);
    const chunk = await db.get<{ data: string }>(meta.children[0]);
    expect(chunk.data).toContain('exact words here 123');
  });

  it('rejects an empty brain-dump', async () => {
    await expect(capture('   ', depsWithId(fixedId))).rejects.toThrow();
  });

  it('writeFile deduplicates identical content chunks across different paths', async () => {
    // Two distinct files with identical body content share one content-addressed chunk.
    const opts = { ctime: fixedNow, mtime: fixedNow, hash: sha1Hex, settings };
    const a = await writeFile(db, '_dumps/a.md', 'identical body', opts);
    const b = await writeFile(db, '_dumps/b.md', 'identical body', opts);

    expect(a.chunkId).toBe(b.chunkId);

    const all = await db.allDocs({ include_docs: true });
    const chunks = all.rows.filter((r) => (r.doc as { type?: string })?.type === 'leaf');
    const metas = all.rows.filter((r) => (r.doc as { type?: string })?.type === 'plain');
    expect(chunks).toHaveLength(1);
    expect(metas).toHaveLength(2);
  });

  it('docIdForPath lowercases (case-insensitive) and prefixes underscore-leading folders', () => {
    expect(docIdForPath('_dumps/Foo.md', settings)).toBe('/_dumps/foo.md');
    expect(docIdForPath('Brain Dump/Note.md', settings)).toBe('brain dump/note.md');
  });

  it('docIdForPath preserves case when case-sensitive', () => {
    const cs: Settings = { ...settings, caseSensitive: true };
    expect(docIdForPath('_dumps/Foo.md', cs)).toBe('/_dumps/Foo.md');
    expect(docIdForPath('Brain Dump/Note.md', cs)).toBe('Brain Dump/Note.md');
  });
});
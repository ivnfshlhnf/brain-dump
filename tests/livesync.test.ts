// The LiveSync document format's invariants — the ones Obsidian validates on its side
// and refuses the file over. Asserted here because the cost of getting them wrong is not
// a failed write: it is a file Obsidian calls corrupted, never puts on disk, and then
// deletes from the database because it is "missing on storage" (dogfooding finding 04).
import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import PouchDB from 'pouchdb-core';
import memory from 'pouchdb-adapter-memory';
import { writeFile, modifyFile, restoreFile, docIdForPath } from '../src/lib/livesync';
import { DEFAULT_SETTINGS, type DocStore, type Settings } from '../src/lib/types';

PouchDB.plugin(memory);
const settings: Settings = { ...DEFAULT_SETTINGS, managedFolder: 'Brain Dump' };
const hash = (c: string) => Promise.resolve(createHash('sha1').update(c).digest('hex'));
const now = Date.UTC(2026, 7, 21);

let db: DocStore;
let seq = 0;
beforeEach(() => {
  db = new PouchDB('ls' + seq++, { adapter: 'memory' }) as unknown as DocStore;
});

const meta = (path: string) =>
  db.get<{ size: number; deleted?: boolean; children: string[] }>(docIdForPath(path, settings));

describe('declared size', () => {
  // An em-dash is one UTF-16 code unit and three UTF-8 bytes. Organize puts them in
  // almost every Note, so this is the common case, not an exotic one.
  const text = 'A Note — with an em-dash, an arrow → and an emoji 😅';

  it('is the content’s UTF-8 byte length, not its UTF-16 code-unit count', async () => {
    await writeFile(db, 'Brain Dump/note.md', text, { ctime: now, mtime: now, hash, settings });

    const { size } = await meta('Brain Dump/note.md');
    expect(size).toBe(Buffer.byteLength(text, 'utf8'));
    expect(size).not.toBe(text.length); // the bug: 8 bytes short, and Obsidian refuses the file
  });

  it('stays correct when the file is modified', async () => {
    await writeFile(db, 'Brain Dump/note.md', 'plain ascii', { ctime: now, mtime: now, hash, settings });
    await modifyFile(db, 'Brain Dump/note.md', () => text, { mtime: now, hash, settings });

    expect((await meta('Brain Dump/note.md')).size).toBe(Buffer.byteLength(text, 'utf8'));
  });

  it('is pure ASCII’s length either way — which is why this went unnoticed', async () => {
    const ascii = 'no special characters here';
    await writeFile(db, 'Brain Dump/ascii.md', ascii, { ctime: now, mtime: now, hash, settings });

    expect((await meta('Brain Dump/ascii.md')).size).toBe(ascii.length);
  });
});

describe('restoreFile', () => {
  const text = 'A Note — deleted, then restored';

  /** A soft delete, the way Obsidian LiveSync does it. */
  async function softDelete(path: string): Promise<void> {
    const doc = await db.get<Record<string, unknown>>(docIdForPath(path, settings));
    await db.put({ ...doc, deleted: true });
  }

  it('clears the flag and keeps the content', async () => {
    await writeFile(db, 'Brain Dump/note.md', text, { ctime: now, mtime: now, hash, settings });
    await softDelete('Brain Dump/note.md');
    expect((await meta('Brain Dump/note.md')).deleted).toBe(true);

    await restoreFile(db, 'Brain Dump/note.md', settings);

    const doc = await meta('Brain Dump/note.md');
    expect(doc.deleted).toBeUndefined();
    expect(doc.children).toHaveLength(1);
  });

  it('corrects a size that was wrong, so the restored file is not refused again', async () => {
    // A document written by the old code: size in UTF-16 code units. Restoring it without
    // fixing that hands Obsidian the same file it already called corrupted, and the
    // offline scanner deletes it a second time.
    await writeFile(db, 'Brain Dump/note.md', text, { ctime: now, mtime: now, hash, settings });
    const doc = await db.get<Record<string, unknown>>(docIdForPath('Brain Dump/note.md', settings));
    await db.put({ ...doc, size: text.length, deleted: true });

    await restoreFile(db, 'Brain Dump/note.md', settings);

    expect((await meta('Brain Dump/note.md')).size).toBe(Buffer.byteLength(text, 'utf8'));
  });

  it('is a no-op for a file that is not deleted', async () => {
    await writeFile(db, 'Brain Dump/note.md', text, { ctime: now, mtime: now, hash, settings });
    const before = await meta('Brain Dump/note.md');
    await restoreFile(db, 'Brain Dump/note.md', settings);
    expect(await meta('Brain Dump/note.md')).toEqual(before);
  });
});

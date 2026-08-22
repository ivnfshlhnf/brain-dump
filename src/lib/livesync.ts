// Reads and writes files in the LiveSync CouchDB store, in LiveSync's internal
// document format. See ADR-0001. Each file is one metadata doc plus one or more
// content-addressed chunk docs — the app writes a single chunk per file, but reads
// tolerate the several chunks LiveSync itself writes for a larger file.
import type { DocStore, Settings } from './types';

export type HashFn = (content: string) => Promise<string>;

/** Default chunk hash: SHA-1 hex (Web Crypto). Must match the user's LiveSync hash. */
export async function defaultSha1Hex(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const buf = await crypto.subtle.digest('SHA-1', data);
  return toHex(new Uint8Array(buf));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Compute the LiveSync metadata doc _id from a vault-relative path. */
export function docIdForPath(path: string, settings: Settings): string {
  let id = path;
  if (id.startsWith('_')) id = '/' + id; // underscore-leading folders get a leading slash
  if (!settings.caseSensitive) id = id.toLowerCase();
  return id;
}

export interface WrittenDoc {
  metadataId: string;
  chunkId: string;
}

/** Write a file (a Dump or a Note) as a metadata doc + a single content-addressed chunk doc. */
export async function writeFile(
  db: DocStore,
  path: string,
  content: string,
  opts: { ctime: number; mtime: number; hash: HashFn; settings: Settings },
): Promise<WrittenDoc> {
  const chunkId = 'h:' + (await opts.hash(content));

  // Content-addressed chunk: if an identical chunk already exists, that's dedup — keep it.
  const chunkDoc: Record<string, unknown> = { _id: chunkId, type: 'leaf', data: content };
  try {
    await db.put(chunkDoc);
  } catch (e) {
    if (!isConflict(e)) throw e;
  }

  const metadataId = docIdForPath(path, opts.settings);
  const metadataDoc: Record<string, unknown> = {
    _id: metadataId,
    path, // original-case vault-relative path
    children: [chunkId],
    ctime: opts.ctime,
    mtime: opts.mtime,
    size: content.length,
    type: 'plain',
    eden: {},
  };
  await putMetadata(db, metadataDoc);

  return { metadataId, chunkId };
}

/** Upsert a metadata doc: on a 409 (the path already exists, e.g. adding Context
 *  rewrites the Dump), re-fetch its `_rev` and retry. Fresh writes hit the fast path. */
async function putMetadata(db: DocStore, doc: Record<string, unknown>): Promise<void> {
  try {
    await db.put(doc);
  } catch (e) {
    if (!isConflict(e)) throw e;
    const existing = await db.get<{ _rev: string }>(doc._id as string);
    await db.put({ ...doc, _rev: existing._rev });
  }
}

/** A 409 from CouchDB — either PouchDB's `status: 409` or its `name: 'conflict'`. */
function isConflict(e: unknown): boolean {
  const err = e as { status?: number; name?: string };
  return err.status === 409 || err.name === 'conflict';
}

/** A file read back out of the vault: its original-case path and full content. */
export interface VaultFile {
  path: string;
  content: string;
}

/** Read every file in the vault, reassembling each one's content from its chunks.
 *  The app writes single-chunk files, but Obsidian LiveSync splits larger files
 *  across several chunks — a personal note read here may be either, so the children
 *  are concatenated in order.
 *
 *  `include` filters by vault-relative path before any chunk is fetched, so a
 *  narrowed read (e.g. just the managed folder) costs only the metadata scan. */
export async function readVaultFiles(
  db: DocStore,
  include: (path: string) => boolean,
): Promise<VaultFile[]> {
  const all = await db.allDocs<{ path?: string; type?: string; children?: string[] }>({
    include_docs: true,
  });
  const files: VaultFile[] = [];
  for (const row of all.rows) {
    const doc = row.doc;
    if (!doc || doc.type !== 'plain' || typeof doc.path !== 'string') continue;
    if (!doc.children?.length || !include(doc.path)) continue;
    const chunks = await Promise.all(
      doc.children.map((id) => db.get<{ data: string }>(id)),
    );
    files.push({ path: doc.path, content: chunks.map((c) => c.data).join('') });
  }
  return files;
}

/** Modify an EXISTING file's content with optimistic concurrency (ticket 04). Reads
 *  the current metadata doc + its chunk, applies `modify` to the current content,
 *  and writes a new content-addressed chunk plus the metadata doc carrying the known
 *  `_rev`. On a 409 (a concurrent edit landed between our read and write), re-fetches
 *  the fresh metadata + fresh content and re-applies `modify` to that — so the user's
 *  concurrent edits are preserved, not clobbered. Throws after `maxAttempts` retries.
 *
 *  Unlike `writeFile` (which creates a fresh file and upserts on conflict), this is a
 *  read-modify-write: the file must already exist, and the transform is re-applied to
 *  the freshest content on each retry. */
export async function modifyFile(
  db: DocStore,
  path: string,
  modify: (current: string) => string | Promise<string>,
  opts: { mtime: number; hash: HashFn; settings: Settings; maxAttempts?: number },
): Promise<WrittenDoc> {
  const metadataId = docIdForPath(path, opts.settings);
  const maxAttempts = opts.maxAttempts ?? 5;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Read the current metadata doc (carries _rev) + its chunk (carries the content).
    const meta = await db.get<
      Record<string, unknown> & { _rev: string; children: string[] }
    >(metadataId);
    const chunk = await db.get<{ data: string }>(meta.children[0]);

    // Re-apply the transform to the freshest content — preserves concurrent edits.
    const newContent = await modify(chunk.data);
    const newChunkId = 'h:' + (await opts.hash(newContent));

    // Content-addressed chunk: an identical chunk already existing is dedup — keep it.
    try {
      await db.put({ _id: newChunkId, type: 'leaf', data: newContent });
    } catch (e) {
      if (!isConflict(e)) throw e;
    }

    // Write the metadata doc with the _rev we read. A 409 here means a concurrent
    // edit landed: loop, re-fetch fresh content, and re-apply the transform.
    try {
      await db.put({ ...meta, children: [newChunkId], mtime: opts.mtime, size: newContent.length });
      return { metadataId, chunkId: newChunkId };
    } catch (e) {
      if (!isConflict(e)) throw e;
    }
  }

  throw new Error(`modifyFile: exceeded ${maxAttempts} conflict retries for ${path}`);
}

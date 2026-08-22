// Shared helpers for the opt-in real-CouchDB smoke tests (Seam B / ticket 07 and
// Seam C / ticket 08). Both tests write through the app's writer to a real CouchDB and
// assert the LiveSync doc-format contract, so the hash, the raw-doc types, the
// format-contract assertion, and the skip/describe gate live here once.
import { describe } from 'vitest';
import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import type { DocStore } from '../src/lib/types';

/** SHA-1 hex, matching the app's default chunk hash (hashAlgorithm: 'sha1') and the
 *  `h:` prefix LiveSync's chunk IDs carry. The reader does not verify this digest (it
 *  fetches children by _id, not by recomputing the hash), so callers assert the `h:`
 *  convention and the children↔leaf linkage, not the digest value. */
export function sha1Hex(content: string): string {
  return createHash('sha1').update(content).digest('hex');
}

/** The hash callback handed to the app's writer — every write uses the identical digest. */
export const fixedHash = (c: string): Promise<string> => Promise.resolve(sha1Hex(c));

/** The http PouchDB exposes destroy beyond the app's DocStore interface; keep a handle to
 *  the raw instance for DB lifecycle, while the operations use it as a DocStore. */
export interface RemoteDb extends DocStore {
  destroy(): Promise<unknown>;
}

// A bare remote doc with its CouchDB rev — enough to inspect the stored shape.
export type RawDoc = Record<string, unknown> & { _id: string; _rev: string };

// The two stored shapes the LiveSync reader cares about: a file's metadata doc and one of
// its chunk (leaf) docs. Named rather than re-intersected ad hoc at each assertion.
export type MetaDoc = RawDoc & {
  type: string;
  path: string;
  children: string[];
  eden: unknown;
  ctime: number;
  mtime: number;
  size: number;
};
export type LeafDoc = RawDoc & { type: string; data: string };

/** Assert a written file's metadata doc + its single leaf satisfy LiveSync's reader
 *  contract, then return them for any file-specific extra assertions. Mirrors the reader's
 *  acceptance checks: `getDBEntryMetaByPath` (type/plain, children, eden, ctime/mtime),
 *  `isChunkDoc` (type === "leaf"), and `ChunkFetcher` (data is a string). */
export async function assertLiveSyncFile(
  store: DocStore,
  written: { metadataId: string; chunkId: string; path: string },
  opts: { ctime: number },
): Promise<{ meta: MetaDoc; leaf: LeafDoc }> {
  const meta = await store.get<MetaDoc>(written.metadataId);
  expect(meta.type).toBe('plain');
  expect(meta.path).toBe(written.path); // original case preserved
  expect(meta.children).toEqual([written.chunkId]); // the child id resolves to the leaf
  expect(meta.eden).toEqual({}); // reader defaults missing eden to {} and accepts {}
  expect(meta.ctime).toBe(opts.ctime);
  expect(meta.mtime).toBe(opts.ctime);
  expect(meta.size).toBeGreaterThan(0);

  const leaf = await store.get<LeafDoc>(written.chunkId);
  expect(leaf._id).toBe(written.chunkId); // stored under the id the metadata references
  expect(leaf._id.startsWith('h:')).toBe(true); // LiveSync chunk-id convention (IDPrefixes.Chunk)
  expect(leaf.type).toBe('leaf'); // isChunkDoc requires type === "leaf"
  expect(typeof leaf.data).toBe('string'); // ChunkFetcher requires string data
  return { meta, leaf };
}

/** `describe` when the caller opted in, `describe.skip` otherwise — so a bare `npm test`
 *  shows the smoke suite is intentionally not run (a visible "skipped" line), not missing.
 *  The return type is left to inference: `describe` and `describe.skip` carry different
 *  chainable types, and the union is directly callable either way. */
export function smokeDescribe(gate: boolean) {
  return gate ? describe : describe.skip;
}
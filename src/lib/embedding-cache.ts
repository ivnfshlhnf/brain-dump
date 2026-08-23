// A persistent, content-addressed cache of document embeddings (ADR-0004).
//
// Retrieve embeds the whole vault on every question, and populating a Note's Related links
// will do the same on every save. Almost all of that work is repeated: a document that has
// not changed produces the same vector every time. This caches by content, so a document is
// embedded once ever rather than once per interaction.
//
// It lives in an app-owned CouchDB database beside the vault database — not inside the vault
// (which would sync megabytes of vectors to a phone and ride on the LiveSync document format)
// and not per-device (which would make every device repeat the same work). See ADR-0004 for
// the alternatives and why they lost.
//
// The cache is a decorator, not a new seam: `createCachingEmbedder` returns an `Embedder`, so
// Retrieve and the operation layer are unchanged and see only the interface they already
// depend on.
//
// Correctness rule: caching is a speed change and never a ranking change. Vectors are stored
// as base64 float32. That is NOT bit-lossless — a provider returns JSON float64 values, and
// float32 keeps about 7 significant digits of each. It is the standard representation for
// embeddings and the rounding is orders of magnitude below what moves a cosine ranking, but
// the honest claim is "ranking-preserving", not "identical bits". Storing float64 would be
// exact at 1.5x the size; float32 was chosen because the precision is not the scarce thing.
//
// A cache that misbehaves must never break a question: every failure falls through to
// embedding normally and is recorded in the diagnostics log.
import type { DocStore, Embedder, Settings } from './types';
import { noopLog, type Log } from './logger';

export interface CachingEmbedderDeps {
  /** The embedder to fall back to on a miss — the real cloud one in the app. */
  inner: Embedder;
  /** The cache database. Omit to disable caching entirely (the app does this when no
   *  embeddings database is configured). */
  store?: DocStore;
  settings: Settings;
  hash: (content: string) => Promise<string>;
  log?: Log;
}

/** One cached vector. `model` is redundant with the document id but kept readable, since a
 *  human debugging the cache sees the document, not the id it was fetched by. */
interface CachedEmbedding {
  _id: string;
  _rev?: string;
  model: string;
  dimensions: number;
  /** base64-encoded float32 — ~2.5x smaller than JSON floats. */
  vector: string;
}

/** The cache key: the embedder model and the content hash together.
 *
 *  The model must be part of the key. Vectors from two different models occupy different
 *  spaces and are not comparable, so serving one where the other is expected would silently
 *  corrupt every similarity score. Including it means changing the embedder model invalidates
 *  the cache cleanly instead of mixing spaces. */
function cacheId(model: string, contentHash: string): string {
  return `emb:${model}:${contentHash}`;
}

/** An `Embedder` that answers from the cache where it can and embeds only what it must.
 *
 *  Order is preserved exactly: the returned array lines up with `texts` index for index,
 *  regardless of which entries were hits. Getting this wrong would mis-rank the vault while
 *  looking entirely healthy, so it is the property most worth trusting here. */
export function createCachingEmbedder(deps: CachingEmbedderDeps): Embedder {
  const log = deps.log ?? noopLog;

  return {
    async embed(texts): Promise<number[][]> {
      if (texts.length === 0) return [];
      if (!deps.store) return deps.inner.embed(texts);

      const model = deps.settings.embedderModel;
      const ids = await Promise.all(
        texts.map(async (t) => cacheId(model, await deps.hash(t))),
      );

      const cached = await readCached(deps.store, ids, log);

      // Embed only the misses, in one batch, then place each result back at its original
      // index. Duplicate texts within one call share an id, so they are embedded once.
      const missIndexes = ids.map((id, i) => (cached.has(id) ? -1 : i)).filter((i) => i >= 0);
      const uniqueMisses = [...new Set(missIndexes.map((i) => ids[i]))];

      let fresh = new Map<string, number[]>();
      if (uniqueMisses.length > 0) {
        const missTexts = uniqueMisses.map((id) => texts[ids.indexOf(id)]);
        const vectors = await deps.inner.embed(missTexts);
        fresh = new Map(uniqueMisses.map((id, i) => [id, vectors[i] ?? []]));
        await writeCached(deps.store, model, fresh, log);
      }

      log({
        op: 'embed',
        message: 'embedding batch resolved',
        detail: { texts: texts.length, hits: texts.length - missIndexes.length, embedded: uniqueMisses.length },
      });

      return ids.map((id) => cached.get(id) ?? fresh.get(id) ?? []);
    },
  };
}

/** The vectors already cached, by id.
 *
 *  One request for the whole batch, not one per document. Fetching individually would mean a
 *  round trip per vault document on every question and every save — thousands of them on a
 *  real vault — and would fill the console with a 404 for each miss. `allDocs` with explicit
 *  keys asks once and returns a row per key, present or not.
 *
 *  A read that fails is treated as a total miss: the answer stays correct and only costs more.
 */
async function readCached(
  store: DocStore,
  ids: string[],
  log: Log,
): Promise<Map<string, number[]>> {
  const found = new Map<string, number[]>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return found;

  try {
    const result = await store.allDocs<CachedEmbedding>({ keys: unique, include_docs: true });
    for (const row of result.rows) {
      // A key with no document is a miss, which `allDocs` reports as a row without a doc
      // rather than as an error.
      const doc = row.doc;
      if (doc?.vector && doc._id) found.set(doc._id, decodeVector(doc.vector));
    }
  } catch (e) {
    log({
      level: 'error',
      op: 'embed',
      message: 'could not read the embedding cache — embedding everything',
      detail: { wanted: unique.length, error: (e as Error).message },
    });
    return found;
  }

  return found;
}

/** Store freshly computed vectors. A write failure is logged and otherwise ignored — the
 *  vectors are already in hand, so the caller's result is unaffected and the only cost is
 *  that the next call embeds them again. */
async function writeCached(
  store: DocStore,
  model: string,
  fresh: Map<string, number[]>,
  log: Log,
): Promise<void> {
  await Promise.all(
    [...fresh].map(async ([id, vector]) => {
      try {
        await store.put({ _id: id, model, dimensions: vector.length, vector: encodeVector(vector) });
      } catch (e) {
        log({
          level: 'error',
          op: 'embed',
          message: 'could not cache an embedding',
          detail: { id, error: (e as Error).message },
        });
      }
    }),
  );
}

/** number[] → base64-encoded float32. About 8 KB for a 1536-dimension vector, against ~20 KB
 *  as JSON floats. Values are rounded to float32 precision (~7 significant digits) on the way
 *  in; see the note at the top of this file on why that is acceptable but not "lossless". */
export function encodeVector(vector: number[]): string {
  const bytes = new Uint8Array(new Float32Array(vector).buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return toBase64(binary);
}

export function decodeVector(encoded: string): number[] {
  const binary = fromBase64(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return Array.from(new Float32Array(bytes.buffer));
}

function toBase64(binary: string): string {
  if (typeof btoa === 'function') return btoa(binary);
  return Buffer.from(binary, 'binary').toString('base64');
}

function fromBase64(encoded: string): string {
  if (typeof atob === 'function') return atob(encoded);
  return Buffer.from(encoded, 'base64').toString('binary');
}

// Reading the vault and ranking it by embedding similarity — shared by Retrieve (ranking
// documents against a question) and Related (ranking documents against a new Note).
//
// This exists so the two callers share one definition of "what counts as a vault document"
// and one similarity measure. Two copies would be free to drift, and a drift here is the kind
// that is invisible: rankings would still look plausible while quietly disagreeing.
import { readVaultFiles } from './livesync';
import { parseFrontmatter } from './operations';
import { noopLog, type Log } from './logger';
import type { DocStore, Embedder, Settings, VaultDoc } from './types';

/** Every file in the vault — the app's organized Notes and the user's personal notes alike
 *  (ADR-0002) — with a title to refer to it by.
 *
 *  The raw Dumps are left out: their content is already represented by the Notes organized
 *  from them, so including them would double-count every brain-dump and point at an archive
 *  file the user does not browse. */
export async function readVaultDocs(db: DocStore, settings: Settings): Promise<VaultDoc[]> {
  const files = await readVaultFiles(db, (path) => !path.startsWith(`${settings.dumpsFolder}/`));
  return files.map((file) => ({
    path: file.path,
    title: titleOf(file.path, file.content),
    content: file.content,
  }));
}

/** A Note's frontmatter title, or the filename — a personal note has no frontmatter. */
function titleOf(path: string, content: string): string {
  const title = parseFrontmatter(content).title;
  return title || (path.split('/').pop() ?? path).replace(/\.md$/, '');
}

/** The text of a document as it is embedded. Both callers must embed a document the same way,
 *  or the cache would hold two vectors for one file and the two rankings would disagree. */
export function embeddableText(doc: VaultDoc): string {
  return `${doc.title}\n\n${doc.content}`;
}

/** A document with its similarity to whatever it was ranked against, highest first. */
export interface ScoredDoc {
  doc: VaultDoc;
  score: number;
}

/** Rank `docs` against `subject` by cosine similarity, most similar first.
 *
 *  Returns scores rather than a filtered list, because the two callers want different things
 *  from them: Retrieve takes a fixed number of the best, Related applies a floor. Doing the
 *  cut here would force one policy on both.
 *
 *  The vault is embedded in one batched call. If that call fails — a single document over
 *  the provider's per-input token limit is enough, and the 400 names no document — the pass
 *  falls back to one request per document, so one oversized file costs its own ranking entry
 *  and never the ranking. A document that fails even alone is excluded from the result
 *  entirely rather than scored 0: a fabricated 0 would hand an unranked document to Retrieve
 *  as if it were among the best. */
export async function rankBySimilarity(
  subject: string,
  docs: VaultDoc[],
  embedder: Embedder,
  log: Log = noopLog,
): Promise<ScoredDoc[]> {
  if (docs.length === 0) return [];

  const embedded = await embedVaultVectors(docs, embedder, log);
  // Reachable only when the batch failed and nothing could be embedded per-document:
  // there is no ranking to return, and an empty result is the honest answer — the callers
  // already degrade to no links / no sources.
  if (embedded.length === 0) return [];

  const [subjectVector] = await embedder.embed([subject]);
  // Without an embedding for the subject there is nothing to rank against, and silently
  // returning an arbitrary order would be worse than saying so.
  if (!subjectVector) throw new Error('The embedder returned no embedding for the query text.');

  return embedded
    .map(({ doc, vector }) => ({ doc, score: cosineSimilarity(subjectVector, vector) }))
    .sort((a, b) => b.score - a.score);
}

/** The documents that could be embedded, in input order, each with its vector.
 *
 *  The fast path is one batched call, trusted exactly as before — a missing entry ranks at
 *  0, the contract retrieve.test.ts pins for a malformed response. Only when the batch call
 *  itself throws does the pass fall back to one request per document (sequential, not
 *  parallel — the provider has just failed once, and this path exists for the rare oversized
 *  document, not for throughput). A document that fails or returns nothing even alone is
 *  dropped and its failure logged: ranking it from a truncated prefix would be quietly
 *  wrong, and letting it kill the batch would silently empty every Related section and
 *  break Retrieve. */
async function embedVaultVectors(
  docs: VaultDoc[],
  embedder: Embedder,
  log: Log,
): Promise<Array<{ doc: VaultDoc; vector: number[] }>> {
  try {
    const vectors = await embedder.embed(docs.map(embeddableText));
    return docs.map((doc, i) => ({ doc, vector: vectors[i] ?? [] }));
  } catch (batchError) {
    log({
      op: 'embed',
      message: 'vault embedding batch failed — falling back to one request per document',
      detail: { docs: docs.length, error: (batchError as Error).message },
    });
  }
  const embedded: Array<{ doc: VaultDoc; vector: number[] }> = [];
  for (const doc of docs) {
    try {
      const [vector] = await embedder.embed([embeddableText(doc)]);
      if (vector && vector.length > 0) {
        embedded.push({ doc, vector });
        continue;
      }
      log({
        level: 'error',
        op: 'embed',
        message: 'the embedder returned no embedding for a vault document — excluded from this ranking',
        detail: { path: doc.path },
      });
    } catch (error) {
      log({
        level: 'error',
        op: 'embed',
        message: 'could not embed a vault document — excluded from this ranking',
        detail: { path: doc.path, error: (error as Error).message },
      });
    }
  }
  return embedded;
}

/** Cosine similarity of two equal-length vectors; 0 when either has no magnitude
 *  (an empty embedding says nothing about relevance either way). */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * (b[i] ?? 0);
    magA += a[i] * a[i];
    magB += (b[i] ?? 0) * (b[i] ?? 0);
  }
  if (!magA || !magB) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

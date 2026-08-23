// Reading the vault and ranking it by embedding similarity — shared by Retrieve (ranking
// documents against a question) and Related (ranking documents against a new Note).
//
// This exists so the two callers share one definition of "what counts as a vault document"
// and one similarity measure. Two copies would be free to drift, and a drift here is the kind
// that is invisible: rankings would still look plausible while quietly disagreeing.
import { readVaultFiles } from './livesync';
import { parseFrontmatter } from './operations';
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
 *  cut here would force one policy on both. */
export async function rankBySimilarity(
  subject: string,
  docs: VaultDoc[],
  embedder: Embedder,
): Promise<ScoredDoc[]> {
  if (docs.length === 0) return [];

  const docVectors = await embedder.embed(docs.map(embeddableText));
  const [subjectVector] = await embedder.embed([subject]);
  // Without an embedding for the subject there is nothing to rank against, and silently
  // returning an arbitrary order would be worse than saying so.
  if (!subjectVector) throw new Error('The embedder returned no embedding for the query text.');

  return docs
    .map((doc, i) => ({ doc, score: cosineSimilarity(subjectVector, docVectors[i] ?? []) }))
    .sort((a, b) => b.score - a.score);
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

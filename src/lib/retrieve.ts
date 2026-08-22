// Retrieve — the operation layer's second public entry point (spec §Operation layer):
// answer a natural-language question over the vault and cite the Notes the answer
// drew on.
//
// v1 is re-embed-on-query: every Retrieve fetches the whole vault fresh from CouchDB
// and embeds it, with no persistent vector index. That is deliberate (spec §Out of
// scope) — a `_changes`-fed index is a later optimization for when Retrieve latency
// demands it. Retrieval reads the entire vault, personal notes included, and writes
// nothing (ADR-0002).
import { readVaultFiles } from './livesync';
import type {
  Answerer,
  Citation,
  DocStore,
  Embedder,
  RetrieveResult,
  Settings,
  VaultDoc,
} from './types';
import { parseFrontmatter, wikilink } from './operations';

/** How many of the most similar vault docs are handed to the LLM as context. */
export const RETRIEVE_TOP_K = 5;

/** The answer when there is nothing in the vault to answer from — returned without
 *  calling the model, since there is nothing for it to read. */
export const EMPTY_VAULT_ANSWER = 'There are no Notes in the vault to answer from yet.';

export interface RetrieveDeps {
  db: DocStore;
  settings: Settings;
  embedder: Embedder;
  answerer: Answerer;
}

/** Answer a question from the vault: read every file, embed them and the question,
 *  hand the closest few to the LLM, and cite what it drew on. */
export async function retrieve(question: string, deps: RetrieveDeps): Promise<RetrieveResult> {
  const asked = question.trim();
  if (!asked) throw new Error('Cannot retrieve without a question.');

  const docs = await readVaultDocs(deps.db, deps.settings);
  if (docs.length === 0) return { answer: EMPTY_VAULT_ANSWER, citations: [] };

  const sources = await mostSimilar(asked, docs, deps.embedder);
  const output = await deps.answerer.answer(asked, sources);

  return { answer: output.answer, citations: cite(output.sources, sources) };
}

/** Every file in the vault — the app's organized Notes and the user's personal notes
 *  alike (ADR-0002) — with a title to cite it by.
 *
 *  The raw Dumps are left out: their content is already represented by the Notes
 *  organized from them, so including them would double-count every brain-dump and
 *  cite an archive file the user does not browse. A Dump whose Note has not been
 *  written yet is therefore not retrievable until it is. */
async function readVaultDocs(db: DocStore, settings: Settings): Promise<VaultDoc[]> {
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

/** The `RETRIEVE_TOP_K` vault docs closest to the question, most similar first. The
 *  whole vault is embedded on every call — see the re-embed-on-query note above. */
async function mostSimilar(
  question: string,
  docs: VaultDoc[],
  embedder: Embedder,
): Promise<VaultDoc[]> {
  const docVectors = await embedder.embed(docs.map((d) => `${d.title}\n\n${d.content}`));
  const [questionVector] = await embedder.embed([question]);
  // Without an embedding for the question there is nothing to rank against, and
  // silently answering from an arbitrary five Notes would be worse than saying so.
  if (!questionVector) throw new Error('The embedder returned no embedding for the question.');

  return docs
    .map((doc, i) => ({ doc, score: cosineSimilarity(questionVector, docVectors[i] ?? []) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, RETRIEVE_TOP_K)
    .map((scored) => scored.doc);
}

/** Cosine similarity of two equal-length vectors; 0 when either has no magnitude
 *  (an empty embedding says nothing about relevance either way). */
function cosineSimilarity(a: number[], b: number[]): number {
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

/** The docs the model said it drew on, as citations the user can open.
 *
 *  Naming nothing is a real answer — "I couldn't find that in your notes" must not
 *  arrive with five citations stapled to it — so an empty choice cites nothing.
 *  Indexes the model invents are dropped instead; if it named sources but every one
 *  was bogus, the docs it was actually given are cited, so the user still has a way
 *  back to what the answer was drawn from rather than a dead link. */
function cite(chosen: number[], sources: VaultDoc[]): Citation[] {
  if (chosen.length === 0) return [];
  const valid = chosen.filter((i) => Number.isInteger(i) && i >= 0 && i < sources.length);
  const cited = valid.length ? valid.map((i) => sources[i]) : sources;
  return cited.map((doc) => ({ path: doc.path, title: doc.title, link: wikilink(doc.path) }));
}

// Retrieve — the operation layer's second public entry point (spec §Operation layer):
// answer a natural-language question over the vault and cite the Notes the answer
// drew on.
//
// v1 is re-embed-on-query: every Retrieve fetches the whole vault fresh from CouchDB
// and embeds it, with no persistent vector index. That is deliberate (spec §Out of
// scope) — a `_changes`-fed index is a later optimization for when Retrieve latency
// demands it. Retrieval reads the entire vault, personal notes included, and writes
// nothing (ADR-0002).
import { readVaultDocs, rankBySimilarity } from './vault-search';
import type {
  Answerer,
  Citation,
  DocStore,
  Embedder,
  RetrieveResult,
  Settings,
  VaultDoc,
} from './types';
import { noopLog, type Log } from './logger';
import { wikilink } from './operations';

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
  log?: Log;
}

/** Answer a question from the vault: read every file, embed them and the question,
 *  hand the closest few to the LLM, and cite what it drew on. */
export async function retrieve(question: string, deps: RetrieveDeps): Promise<RetrieveResult> {
  const log = deps.log ?? noopLog;
  const asked = question.trim();
  if (!asked) throw new Error('Cannot retrieve without a question.');

  const docs = await readVaultDocs(deps.db, deps.settings);
  if (docs.length === 0) return { answer: EMPTY_VAULT_ANSWER, citations: [] };

  const sources = await mostSimilar(asked, docs, deps.embedder, log);
  const output = await deps.answerer.answer(asked, sources);

  return { answer: output.answer, citations: cite(output.sources, sources) };
}

/** The `RETRIEVE_TOP_K` vault docs closest to the question, most similar first. */
async function mostSimilar(
  question: string,
  docs: VaultDoc[],
  embedder: Embedder,
  log: Log,
): Promise<VaultDoc[]> {
  const ranked = await rankBySimilarity(question, docs, embedder, log);
  return ranked.slice(0, RETRIEVE_TOP_K).map((scored) => scored.doc);
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

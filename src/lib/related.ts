// Populating a Note's Related links (related-notes ticket 02).
//
// Organize alone cannot do this. It is handed one thing — the text of the Dump — so it has
// never seen the vault, another Note's title, or a path. Its only options are an empty list or
// an invented wikilink to a document that may not exist. That is why `## Related` was empty on
// every Note the app has ever written, and why no better model or longer prompt would fix it.
//
// So relatedness is computed here instead, as a hybrid: embedding similarity ranks the whole
// vault against the finished Note and shortlists the closest candidates above a floor, then the
// LLM judges which of that shortlist are genuinely Related. Embeddings do the scaling and
// supply the paths; the model does the judgment it is actually good at.
//
// Dead links are impossible by construction: every candidate path comes from the vault, and the
// model only ever returns an index into a list the app built.
//
// Links are outbound only — this never writes to another Note. Obsidian's own "Linked mentions"
// panel shows the reverse direction with no file edit, so the bidirectional reading experience
// costs nothing and no Note the user did not just create is ever touched.
import { wikilink } from './operations';
import { readVaultDocs, rankBySimilarity, type ScoredDoc } from './vault-search';
import { noopLog, type Log } from './logger';
import type { DocStore, Embedder, Note, Relater, Settings, VaultDoc } from './types';

/** At most this many Related links on a Note. A `## Related` section with fifteen entries is
 *  a link dump, which makes the Note worse rather than better. */
export const RELATED_MAX = 5;

/** The similarity a document must reach to be worth showing the model at all.
 *
 *  Without a floor, a nearly-empty vault would offer its five least-irrelevant documents and
 *  the section would fill with noise. The rule is "no Related links rather than weak ones". */
export const RELATED_MIN_SIMILARITY = 0.35;

export interface RelatedDeps {
  db: DocStore;
  settings: Settings;
  embedder: Embedder;
  relater: Relater;
  log?: Log;
}

/** Obsidian wikilinks to the documents genuinely Related to `note`, or an empty list.
 *
 *  `excludePath` keeps a Note from listing itself — on a re-save or an Append the Note is
 *  already in the vault and would otherwise rank as its own closest match. */
export async function findRelated(
  note: Note,
  excludePath: string,
  deps: RelatedDeps,
): Promise<string[]> {
  const log = deps.log ?? noopLog;

  const docs = (await readVaultDocs(deps.db, deps.settings)).filter((d) => d.path !== excludePath);
  if (docs.length === 0) return [];

  const subject = `${note.title}\n\n${note.summary}\n\n${note.body}`;
  const ranked = await rankBySimilarity(subject, docs, deps.embedder, log);
  const shortlist = shortlistOf(ranked);

  if (shortlist.length === 0) {
    log({
      op: 'related',
      message: 'nothing cleared the similarity floor',
      detail: { candidates: docs.length, floor: RELATED_MIN_SIMILARITY },
    });
    return [];
  }

  const chosen = await judge(shortlist, note, deps, log);
  log({
    op: 'related',
    message: 'related links resolved',
    detail: { candidates: docs.length, shortlisted: shortlist.length, linked: chosen.length },
  });
  return chosen.map((doc) => wikilink(doc.path));
}

/** The documents worth showing the model: above the floor, best first, capped. */
function shortlistOf(ranked: ScoredDoc[]): VaultDoc[] {
  return ranked
    .filter((scored) => scored.score >= RELATED_MIN_SIMILARITY)
    .slice(0, RELATED_MAX)
    .map((scored) => scored.doc);
}

/** Ask the model which of the shortlist are genuinely Related, and keep only the answers that
 *  address a real candidate.
 *
 *  Out-of-range and duplicate indexes are dropped rather than trusted. A model that invents an
 *  index must not be able to turn that into a link, and the same index twice must not produce
 *  the same link twice. If the call fails, the Note is saved with no Related links — losing the
 *  links is a far better outcome than losing the Note. */
async function judge(
  shortlist: VaultDoc[],
  note: Note,
  deps: RelatedDeps,
  log: Log,
): Promise<VaultDoc[]> {
  let indexes: number[];
  try {
    indexes = await deps.relater.related(
      { title: note.title, summary: note.summary, content: note.body },
      shortlist,
    );
  } catch (e) {
    log({
      level: 'error',
      op: 'related',
      message: 'could not judge related links — saving the Note without them',
      detail: { error: (e as Error).message },
    });
    // The failure propagates so the caller can tell a judge that failed from one that saw
    // nothing close (capture-latency ticket 04) — every caller already treats a rejection
    // as "file without links".
    throw e;
  }

  const valid = indexes.filter(
    (i) => Number.isInteger(i) && i >= 0 && i < shortlist.length,
  );
  return [...new Set(valid)].map((i) => shortlist[i]);
}

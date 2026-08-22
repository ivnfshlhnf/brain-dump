**Status:** ready-for-agent

# 11 — Populate a Note's Related links

**What to build:** Fill a Note's `## Related` section with links to genuinely related
existing documents, ranked by embedding similarity and judged by the LLM, computed at final
save over the whole vault. Outbound links only — no reverse links written into other Notes.

**Blocked by:** 10 — embedding cache (Related ranks over the whole vault on the capture
path; without the cache this costs a full-vault embed per capture).

## Problem Statement

`related` has never contained a real link, and structurally could not. `organizeNote`
(`src/lib/operations.ts:166`) copies it straight from the Organizer's output, and
`createOrganizer` is given exactly one thing: the text of the Dump. It has never seen the
vault, another Note's title, or a path. Its only options are to return `[]` or to invent a
wikilink to a Note that may not exist — and inventing one would write a dead link into the
vault, the bug class ticket 06 hunted down.

Dogfooding confirmed it: two Notes captured on clearly related topics both came back with an
empty `## Related`. No better model and no longer prompt can fix this, because the
information required is not in the request.

Meanwhile the app already contains two vault-aware components that are not wired to
`related`: `matchNote` (`operations.ts:435`) loads path/title/tags/summary for every managed
Note, and `retrieve.ts` ranks documents by `cosineSimilarity`.

## Solution

Compute Related as a **hybrid**: embedding similarity shortlists candidates from the whole
vault, then the LLM judges which of the shortlist are genuinely related. Embeddings do the
scaling and guarantee every candidate path actually exists; the LLM throws out the ones that
are merely similar-sounding. Runs during the **final Organize at save**, not at capture, so
the preview and the capture path stay instant.

Links are **outbound only**. Obsidian's own "Linked mentions" panel surfaces the reverse
direction with no file edit, so the bidirectional experience comes for free without the app
writing into Notes the user did not just create.

## User Stories

1. As the user, I want a new Note to link to existing documents it is genuinely related to,
   so that my vault accumulates connections instead of isolated Notes.
2. As the user, I want related links drawn from my whole vault, so that a brain-dump can
   connect to the personal notes where most of my knowledge lives.
3. As the user, I want every related link to point at a document that exists, so that my
   vault never accumulates dead links.
4. As the user, I want to see the reverse connection when reading the older Note, so that
   relatedness is useful from both ends (via Obsidian's Linked mentions — no file edit).
5. As the user, I want my existing Notes left untouched when a new related Note appears, so
   that the app never edits a Note I did not just create.
6. As the user, I want at most a handful of related links, so that `## Related` stays useful
   rather than becoming a link dump.
7. As the user, I want no related links rather than weak ones, so that the section means
   something when it is populated.
8. As the user, I want capture and the Note preview to stay instant, so that adding related
   links does not cost the app its whole point.

## Implementation Decisions

- **Vocabulary (CONTEXT.md):** **Related** is any genuine connection between two Notes that
  is not strong enough to **Append** — Related and Append are the same judgment at two
  thresholds. Append merges content into one Note; Related leaves two documents linked.
- **Hybrid ranking.** Embed the new Note, rank the whole vault by cosine similarity, keep
  candidates above a similarity floor, cap the shortlist, then ask the LLM which are truly
  related. Paths come from the vault, never from the model — a dead link is impossible by
  construction.
- **Whole vault, per ADR-0002's read scope.** Personal notes are eligible. This is safe
  precisely because links are outbound only: ADR-0002 forbids writing to personal notes, and
  nothing here writes to them.
- **Cap at 5, plus a similarity floor.** The cap keeps `## Related` readable; the floor
  keeps a nearly-empty vault from linking five irrelevant documents just because they ranked
  highest. Both are named constants next to `RETRIEVE_TOP_K`.
- **Computed at final save.** `finalizeCapture` already re-Organizes over the full Dump; the
  Related pass belongs there. The preview shows no related links, deliberately — they are a
  browsing affordance read days later in Obsidian, not in the two seconds after typing.
- **No reverse links.** Writing into an existing Note's `## Related` would reverse three
  spec decisions (metadata refresh is explicit, app writes to existing Notes are append-only
  dated sections, hand-edits are never overwritten) and multiply the write and 409-retry
  surface per capture. Obsidian's Linked mentions panel already provides the reverse view.
- **The Dump's own Note is excluded** from its own candidate list.
- **Append and Related are computed from the same ranking**, so the near-misses the Append
  decision discards are exactly what populates Related.

## Testing Decisions

- Seam A: drive the finalize path with a fake embedder returning controlled vectors and a
  fake judge, asserting on the Note actually written.
- Every emitted link must correspond to a document present in the fake vault — the
  dead-link guarantee is the single most important assertion.
- A vault where nothing clears the floor yields an empty `## Related`, not five weak links.
- More than `RELATED_MAX` qualifying documents yields exactly `RELATED_MAX`.
- No document other than the new Note is written during finalize — pins "no reverse links"
  as a tested property rather than an intention.
- The Note preview at capture is unchanged (no related links, no embedding call).

## Out of Scope

- Reverse links written into other Notes (see above; would want its own ADR).
- Re-computing Related for existing Notes when a new Note appears — Related is computed once
  at save. A vault-wide refresh is a separate, explicit operation if ever wanted.
- Relatedness shown in the capture preview.
- Tag-granularity work. Considered and dropped: with embedding-based shortlisting, ranking
  is driven by content, not tags, so making tags more granular does not affect Related.

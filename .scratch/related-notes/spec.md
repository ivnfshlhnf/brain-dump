Status: ready-for-agent

# Related Notes

## Problem Statement

Every Note the app writes has a `## Related` section, and it has been empty every single
time. The v1 Note schema promised related links (spec story 32), the section is rendered into
every Note file, and nothing has ever appeared in it.

This was found by dogfooding, not by testing: two Notes were captured on clearly connected
topics, and both came back with an empty `## Related`. The natural conclusions — that the
chat model isn't clever enough, or that the prompt needs to be more thorough, or that the
tags need to be more granular — are all wrong, and each would waste effort. The Organizer is
handed exactly one thing: the text of the Dump being organized. It has never seen the vault,
another Note's title, or a path. Its only two options are to return an empty list or to
invent a wikilink to a document that may not exist — and inventing one would write a dead
link into the user's vault, the bug class brain-dump-v1's ticket 06 was built to prevent.

So the vault accumulates isolated Notes. The whole premise of capturing thoughts into a
knowledge base is that they connect to each other over time, and right now nothing connects
to anything. The user has to rediscover the connections by hand, which is exactly the work
the app exists to remove.

There is a second problem behind the first. Fixing this means ranking a new Note against the
vault, and the app has no persistent embedding index — every Retrieve re-embeds the whole
vault from scratch. Doing that on the capture path too would embed the vault twice per
interaction, which is affordable in money and unaffordable in latency on the one code path
whose entire purpose is to feel instant.

## Solution

A Note's `## Related` section is populated at save time with links to documents from
anywhere in the vault that it is genuinely related to, and every link points at a document
that actually exists.

Relatedness is computed as a **hybrid**: embedding similarity ranks the whole vault against
the new Note and shortlists the closest candidates above a similarity floor; the LLM is then
shown that shortlist and judges which are genuinely related rather than merely
similar-sounding. Embeddings do the scaling and guarantee validity — every candidate path
comes from the vault, never from the model, so a dead link is impossible by construction.
The LLM does the judgment it is actually good at.

Links are **outbound only**. The app writes related links into the Note it just created and
never edits any other Note. The reverse direction is not lost: Obsidian's own "Linked
mentions" panel shows the incoming links on the older Note automatically, with no file edit
at all — so the bidirectional reading experience comes for free without the app touching a
Note the user did not just create.

This runs during the **final Organize at save**, never at capture. Related links are a
browsing affordance read days later in Obsidian, not something needed in the two seconds
after typing a thought, so the capture path and the Note preview stay instant.

Making that affordable requires a **persistent embedding cache**, keyed by the content hash
the app already computes for every file, stored in an app-owned CouchDB database alongside
the vault. A document is embedded once ever instead of once per interaction. It is shared
across every device, since they all talk to the same CouchDB, and it lives outside the vault
so Obsidian never sees or syncs megabytes of vectors. This reverses v1's documented decision
to ship without a vector index, and retroactively removes Retrieve's known scaling cliff.

## User Stories

1. As the user, I want a new Note to link to documents it is genuinely related to, so that my
   vault accumulates connections instead of isolated Notes.
2. As the user, I want related links drawn from my whole vault, so that a brain-dump can
   connect to the personal notes where most of my knowledge actually lives.
3. As the user, I want every related link to point at a document that exists, so that my
   vault never accumulates dead links.
4. As the user, I want to see the connection from the older Note too, so that relatedness is
   useful from both ends of the link.
5. As the user, I want my existing Notes left untouched when a new related Note appears, so
   that the app never edits a Note I did not just create.
6. As the user, I want at most a handful of related links on a Note, so that `## Related`
   stays readable rather than becoming a link dump.
7. As the user, I want no related links at all rather than weak ones, so that the section
   means something when it is populated.
8. As the user, I want capture and the Note preview to stay instant, so that adding related
   links does not cost the app the responsiveness that is its whole point.
9. As the user, I want a Note's related links decided from its full content including any
   Context I added, so that the connections reflect the finished thought and not the first
   draft of it.
10. As the user, I want a Note never to list itself as related, so that the section carries
    only real connections.
11. As the user, I want related links written in Obsidian's wikilink format, so that they are
    clickable in my vault like any other link.
12. As the user, I want my raw Dumps excluded from related links, so that the section points
    at Notes I browse rather than archive files I do not.
13. As the user, I want a document embedded only once, so that repeated questions and
    captures do not pay to re-embed a vault that has not changed.
14. As the user, I want an edited document re-embedded automatically, so that relatedness and
    retrieval reflect what the document says now, not what it said last week.
15. As the user, I want the embedding work shared across my devices, so that my phone
    benefits from what my laptop already computed.
16. As the user, I want the embedding cache kept out of my Obsidian vault, so that my vault
    stays notes and does not sync megabytes of vectors to my phone.
17. As the user, I want answers and related links to be identical whether or not the cache is
    warm, so that caching is a speed change and never a correctness change.
18. As the user, I want the app to keep working when the cache is unavailable, so that a
    missing or unreachable database costs me speed rather than function.
19. As the user, I want questions to get faster as the cache warms, so that Retrieve stays
    usable as my vault grows.
20. As the user, I want to change my embedder model without getting nonsense results, so that
    switching models is safe.
21. As the maintainer, I want the cache database name configurable, so that it can be pointed
    elsewhere on a shared CouchDB.
22. As the maintainer, I want a fallback when CouchDB will not allow a second database, so
    that a non-admin account does not block the feature entirely.
23. As the maintainer, I want cache failures recorded in the diagnostics log, so that a
    silently-disabled cache is visible rather than mysterious.
24. As the maintainer, I want the related-links computation driven through the existing
    operation layer, so that this feature adds no new test seam.
25. As the maintainer, I want "no other Note is written during save" to be a tested property,
    so that "outbound links only" cannot regress into silently editing the user's Notes.

## Implementation Decisions

- **Vocabulary.** **Related** is defined in `CONTEXT.md` as any genuine connection between
  two Notes that is not strong enough to **Append** — the two remain separate documents.
  Related and Append are the same judgment at two thresholds: Append merges content into one
  Note, Related leaves two documents linked. The `CONTEXT.md` **Organize** entry records that
  related links are the one part of Organize that cannot be derived from the Dump alone.

- **Two tickets, ordered.** `01 — embedding cache` blocks `02 — populate Related`. The cache
  is not an optimization here; it is the enabler that makes whole-vault ranking on the
  capture path affordable.

- **Hybrid ranking.** Embed the finished Note, rank the whole vault by cosine similarity,
  keep candidates above a similarity floor, cap the shortlist, then ask the LLM which of the
  shortlist are truly related. Candidate paths come from the vault and are validated against
  it before being written — the model selects from a list, it never supplies a path.

- **Whole-vault scope, consistent with ADR-0002.** Personal notes are eligible as related
  targets. This is safe precisely because links are outbound only: ADR-0002 forbids writing
  outside the managed folders, and nothing here writes to a personal note.

- **A floor and a cap, both named constants** alongside the existing `RETRIEVE_TOP_K`. The
  cap (5) keeps the section readable; the floor stops a nearly-empty vault from linking five
  irrelevant documents merely because they ranked highest.

- **Computed at final save, not at capture.** The finalize path already re-Organizes over the
  full Dump (original plus Context), so the related pass belongs there and sees the finished
  thought. The capture preview deliberately shows no related links and makes no embedding
  call.

- **No reverse links.** Writing into an existing Note's `## Related` would reverse three v1
  decisions — metadata refresh is explicitly user-triggered, app writes to existing Notes are
  append-only dated sections, and hand-edits are never overwritten — and would multiply the
  write and 409-retry surface per capture. Obsidian's Linked mentions panel already provides
  the reverse view. Revisiting this would warrant its own ADR.

- **Exclusions.** A Note never lists itself. Raw Dumps are excluded from candidates, matching
  the existing Retrieve rule that a Dump's content is already represented by its Note.

- **Cache storage: a sibling CouchDB database** (ADR-0004), default name configurable, holding
  plain app-owned documents rather than LiveSync-format files. Not in the vault, and not
  per-device. The rejected alternatives — in-vault storage and per-device IndexedDB — and
  their reasons are recorded in the ADR.

- **Cache key: the content hash the app already computes** for the LiveSync chunk id, paired
  with the embedder model. Including the model means changing `embedderModel` invalidates
  cleanly instead of mixing incompatible vector spaces.

- **Vector encoding: base64 float32.** Roughly 8 KB per 1536-dimension vector against ~20 KB
  as JSON floats. This is ranking-preserving rather than bit-lossless: a provider returns
  float64 values and float32 keeps about seven significant digits, which is far below what moves
  a cosine ranking. Quantisation was considered and rejected — it rounds by a margin that could
  move a ranking, for bytes that are not scarce once the cache is out of the vault.

- **The cache wraps the `Embedder` interface rather than changing it.** A caching embedder
  satisfies the existing interface, so retrieval and the related-links pass are unchanged and
  every existing test keeps passing with a plain fake.

- **Cache failure degrades speed, never correctness.** A read or write error falls through to
  embedding normally and is recorded in the diagnostics log.

- **Fallback if the database cannot be created.** The CouchDB account in use is not an admin
  and may lack permission to create a second database. This must be confirmed before ticket 01
  relies on it; if refused, a per-device store behind the same interface is the fallback,
  trading one embed per vault for one embed per device.

## Testing Decisions

- **What makes a good test here:** assert only on what the user could observe through the
  operation layer — the Note actually written to the store, the answer and citations returned
  by Retrieve, and which documents were written at all. Never assert on the internals of
  ranking, the cache's document shape, or the prompt text. The cloud LLM and embedder are
  deterministic fakes, so the assertions are about the app's orchestration, never model
  output.

- **No new seams.** Everything is driven at **Seam A — the operation layer**, the repo's
  established primary seam, against an in-memory PouchDB and fake cloud dependencies. This is
  possible for both tickets because `Embedder` is *already* a dependency seam of the operation
  layer: a caching embedder is injected there like any other fake, so cache behaviour is
  observed through the operation layer's results plus a counting inner fake, never by reaching
  into the cache module directly.

- **Prior art:** the existing Seam A suites are the pattern to follow — the append tests for
  asserting on written documents and non-clobbering, the retrieve tests for fake embedders and
  controlled similarity, and the autosave tests for driving the finalize path.

- **The dead-link guarantee is the single most important assertion** in ticket 02: every link
  emitted must correspond to a document present in the fake vault.

- **"No reverse links" must be tested as a property, not trusted as an intention:** assert
  that no document other than the new Note is written during finalize.

- **Other behaviours to pin:** a vault where nothing clears the floor yields an empty section
  rather than weak links; more than the cap of qualifying documents yields exactly the cap; a
  Note never lists itself; the capture preview is unchanged and makes no embedding call.

- **Cache behaviours to pin:** a second request for unchanged content does not reach the inner
  embedder; changed content does; the vectors returned equal the uncached vectors exactly; a
  cache database that throws still produces correct results; switching the embedder model does
  not return vectors computed under the previous model.

## Out of Scope

- **Reverse links written into other Notes.** Obsidian's Linked mentions covers the reading
  experience; doing this for real would reverse three v1 decisions and warrants its own ADR.
- **Re-computing Related for existing Notes** when a new Note appears. Related is computed
  once, at save. A vault-wide refresh would be a separate, explicit operation.
- **Showing related links in the capture preview.** Deliberate: it would put a full ranking
  pass on the path that must feel instant.
- **Tag-granularity work.** Considered and dropped: with embedding-based shortlisting, ranking
  is driven by content rather than tags, so more granular tags would not affect Related.
- **A `_changes`-fed live index.** The cache is a lazy read-through cache, not a subscription.
- **Approximate nearest-neighbour search.** Ranking stays exact cosine over the candidate set;
  the cache changes only where vectors come from.
- **Pre-warming the whole vault** in the background.
- **Vector quantisation.** Considered and rejected in ADR-0004.

## Further Notes

- **This is a fix, not a new feature.** v1's Note schema and user story 32 already promised
  related links; they have simply never worked. The README's Known limitations section records
  the current behaviour honestly until this ships.

- **Why the obvious fixes are wrong.** A more capable chat model, a longer prompt, or more
  granular tags cannot populate this field, because the information required is not in the
  request. This is worth stating explicitly because all three are the natural first guesses,
  and the second-order effect of "fixing" it by prompt alone is worse than the bug: a model
  pushed to always produce related links will invent wikilinks to Notes that do not exist.

- **Cost context.** `openai/text-embedding-3-small` is $0.02 per million input tokens. A
  ~2,000-note vault is roughly $0.02 per full embed; without the cache, ten captures and five
  questions a day is around $9/month and grows linearly with the vault. The recurring cost is
  survivable — the latency is what makes the cache mandatory rather than merely nice.

- **Resolved before ticket 01 starts:** whether the CouchDB account can create a second
  database. Test connection was run against the real server on 2026-08-23 and confirmed it can,
  so the sibling-database decision in ADR-0004 stands on evidence. The per-device fallback stays
  documented as an alternative but should not be built speculatively.

- **Domain vocabulary:** this spec uses the terms defined in `CONTEXT.md` (Dump, Note, Context,
  Organize, Append, Related, Retrieve, Capture, Modality). Implementation should use the same
  vocabulary in code and tests and not drift to the avoided synonyms.

---

## Addendum — Finding 08 follow-up (2026-09-01)

Tickets 01 and 02 shipped, and dogfooding (finding 08 in `.scratch/dogfooding/findings.md`)
found Notes still arriving with an empty `## Related`. Diagnosis against the real embedding
cache and the real models split the loss into two independent causes, and a bake-off (model ×
prompt × case, recorded in full in finding 08) decided the fix order. This addendum scopes
that follow-up; the original spec above is unchanged.

### What the evidence established

- **The hybrid design is sound.** Replayed from the real cache, the ranking put exactly the
  right documents in the top five for both known cases, with clear margin over the 0.35 floor.
  No embedder model change is warranted: all four candidates on the provider
  (`openai/text-embedding-3-small/-3-large`, `google/gemini-embedding-001`,
  `qwen/qwen3-embedding-8b`) ranked every ground-truth sibling into the top five. Embedding
  the parsed Note (title + summary + body) instead of the raw file moved nothing. **Decision:
  keep the embedder model, the floor (0.35), the cap (5), and `embeddableText` as they are.**
- **The judge's prompt is the bug.** The current prompt's clause — "Being about a similar
  subject is not enough on its own. Return an empty array if none qualify — that is a good
  answer, not a failure" — makes the sitting model (`deepseek/deepseek-v4-flash`) reject
  obvious siblings: four historical passes ended `linked: 0`, and a replay returned `[]`.
  With a positive criterion instead, the *same* model returns all five siblings, and every
  model × positive-prompt cell recovers them while all 18 negative-control cells (a Note with
  no true Related) stay empty. Six flash-tier models were tried; the prompt dominates the
  model choice. → **Ticket 03.**
- **The whole-vault embed call is one oversized document away from failure.**
  `rankBySimilarity` (`src/lib/vault-search.ts`) sends every vault document to the embeddings
  endpoint in a single request, and the provider rejects any input over 8192 tokens with a
  400 that kills the whole batch. `fillRelated` catches and saves the Note with no Related —
  silently. The same ranking call underlies Retrieve. Currently dormant (the oversized files
  in the local vault never reach the CouchDB pool the app reads), but accumulating pool
  documents (`random-notes`, `coffee-log`) will cross the limit eventually. → **Ticket 04.**

### Decisions

- **Ticket 03 — fix the judge prompt.** Replace the pessimistic clause with the positive
  criterion proven in the bake-off. No model change, no re-embedding, no cache invalidation.
- **Ticket 04 — make the embed call survive an oversized document.** One failing document
  must cost its own ranking entry, never the whole pass.
- **No model, floor, or text-form change** (the tests say there is nothing to gain and a
  re-embed plus floor recalibration to pay).
- **Out of scope here, decided 2026-09-02:** `recoverPending` never calls `fillRelated`, so
  every Note founded by recovery — every offline Capture — lands with an empty `## Related`
  by construction (`src/lib/operations.ts:1533`). This is finding 08's other loss point; the
  bake-off does not touch it. **Resolved elsewhere:** the capture-latency thread closes it,
  under the rule that Related runs where the wait is free — see ADR-0010 and
  `.scratch/capture-latency/issues/05-recovery-computes-related.md`.
- **Ordering: 03 then 04,** per the user's decision — 03 fixes the observed failure, 04
  hardens the path that has not failed yet.
- **Acceptance loop for 03:** `scripts/debug-related-replay.mjs` (untracked, `[DEBUG-replay]`
  marked) — it re-runs the real judge against the real shortlist from the cached vectors.
  The Seam A suites deliberately never assert on prompt text, so the prompt change is judged
  by the harness, not by unit tests.

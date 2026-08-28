# The Dump is the record; Append merges it and re-organizes the Note wholesale

Append is redefined: instead of inserting a dated section into an existing Note, the new
capture is merged into the target Note's one Dump as a dated section, and the Note is then
re-organized in a single LLM call from the whole accumulated Dump — body and title alike
rewritten. The Note is a view of its Dump, never an independent document that accumulates
state of its own. Decided 2026-08-28 during the append/related rework, closing dogfooding
finding 07.

## Context

The old Append wrote only a dated `## Appended <date>` section into the target Note and left
its frontmatter untouched. That made the Note two things at once — the Organize's rendering of
the first Dump, and a growing pile of later captures the Organize never saw — and the cracks
showed in dogfooding:

- **Finding 07**: the append path computed Related links over the whole vault and then threw
  them away (`appendDumpToNote` writes only the section), so the target kept stale links and
  the vault-ranking cost was paid for nothing.
- Metadata drifted: title, summary, and category described the first capture forever, however
  much the Note grew past it.
- A second capture's content never met the first in any organized form; the Note was a
  concatenation, not a thought.

The rework collapses this to one invariant: **a Note is always the Organize of its entire
Dump.** The Dump accumulates dated sections (one per capture, verbatim); every Organize
regenerates the Note from that Dump alone.

## Considered options

- **Dated sections in the Note** (the status quo). Rejected: it is the bug. Two sources of
  truth mean every append either discards computed work (finding 07) or needs bespoke merging
  into a body the model never wrote as a whole.

- **Merge the existing organized Note with the new Dump** (send the Note plus the capture,
  ask the model to integrate). Rejected: stateful — each append inherits the wording of the
  last, so drift and prompt cruft compound over a Note's lifetime, and the model can never
  see the early captures' original phrasing once they have been condensed away.

- **Rename the Note file when the title changes.** Rejected: other Notes hold the path as a
  `[[wikilink]]`, so a rename either dangles them or forces a link-rewrite fan-out across the
  vault on every title-shifting append — real machinery bought for cosmetics.

- **Preserve manual Note edits by diffing them into the Dump before re-organizing.**
  Rejected: when a hand-edit and the Dump disagree there is no principled winner, and the
  diff machinery would exist to protect exactly the text the model is being asked to
  rewrite. The honest rule is simpler: the Dump is the record, so anything worth keeping
  belongs in it.

- **Merged Dump + wholesale re-organize** (chosen). Stateless — each Organize sees every
  capture verbatim, first to last, so there is nothing to drift. One LLM call per append.
  The merged Dump is written before the Note is touched, which also gives the failure story:
  a failed Organize leaves the old Note intact and a retry re-organizes from the already-
  saved Dump.

## Consequences

- **A Note has exactly one Dump, and the filename is frozen at creation.** The path
  (`Brain Dump/<date>-<slug>.md`) is an identifier, not a label; a rewritten title leaves a
  stale slug, which is accepted as cosmetic. No rename, no dangling links.
- **Manual edits to a Note are provisional.** They last until the next Organize — initial,
  Append, or a manual re-organize — which regenerates body and title from the Dump. This is
  now stated in the glossary (Note) so the behavior is documented rather than surprising.
- **The merge is written only after the user confirms Append**; choosing "New note" instead
  writes a fresh Dump and leaves the target untouched. Once merged, the Dump is the saved
  source of truth — the app never recomputes a Note from memory alone.
- **The capture's own Dump file is marked, not deleted.** After the Note rewrite, its file
  gains `appendedInto: <the Note's wikilink>` in frontmatter. Deleting the file instead would
  still yield a `dump-deleted` Stranded row; the pointer keeps it filed — the thought now
  lives in the target Note — and recovery counts it as already organized rather than founding
  a second Note for it. The window between the merge and the pointer write is accepted: a
  death there leaves recovery to found a fresh Note from the merged Dump.
- **`source` stays a single wikilink** to the one accumulated Dump; the per-section
  `_Source:` lines retire. Existing Notes are not migrated — an old-format Note takes the new
  shape the first time it is appended to, its old `## Appended` sections absorbed like any
  other content.
- **The manual "Re-organize" action becomes a full re-organize** — the same code path as
  Append's, minus the merge — so the word means one thing and there is a manual escape hatch
  for a bad Organize.
- **The organizer prompt loses its `related` field** (dead since Related moved to
  vault-ranked selection); on the append path, `withRelated`'s results are written into the
  target Note instead of discarded, closing finding 07. Related is recomputed on every
  Organize, and links may be dropped when a Note's subject drifts.
- **A new Instruction setting** — one global free-text field, applied verbatim to the
  organizer prompt on every call (e.g. "always write in English regardless of the dump's
  language"). It never reaches the matcher or the Related judge: those judge where content
  belongs, not how it is rendered. Where an Instruction conflicts with a built-in rule, the
  Instruction wins — the user overriding faithfulness is a deliberate act, not a leak.
- **Each append costs one organize call over the whole accumulated Dump**, so prompt length
  grows with the Note. At personal-vault scale this is acceptable; the dumps are already
  stored whole, so nothing new is retained.
Status: ready-for-agent

# Append merges the Dump and re-organizes the Note wholesale

Governing decision: **ADR-0009** (The Dump is the record; Append merges it and re-organizes
the Note wholesale). Glossary: `CONTEXT.md` — Dump, Note, Organize, Append, Related,
Instruction. This spec closes dogfooding finding 07 by design.

## Problem Statement

When I capture a second thought about something I dumped before, the app offers to Append it
to that earlier thought's Note — but what lands is a dated section stapled onto the bottom of
a Note the organizer never saw. The Note becomes two things at once: an organized rendering
of the first capture, and a pile of later captures no one ever organized. The title, summary,
and category still describe only the first capture. The Related links describe only the first
capture — in fact the app computes fresh links for the merge and then throws them away
(finding 07), so the Note's connections go stale the moment it grows.

And the app gives me no way to say how I want my Notes organized. I capture in whatever
language I'm thinking in, but I want every Note in English; today each Note comes out in the
Dump's language, and there is no setting anywhere that lets me say otherwise.

## Solution

A Note has exactly one Dump, and that Dump accumulates every capture as a dated verbatim
section. Append merges the new capture into that one Dump, then re-organizes the Note
wholesale from the accumulated Dump in a single call — body and title alike rewritten, so the
Note always reads as one organized thought, however many captures it holds. Related links are
recomputed on every Organize and written into the Note — links only ever point at Notes that
exist, chosen by content similarity, and links that no longer fit are dropped.

A new Instruction setting lets me write a standing instruction once — "always write in
English regardless of the dump's language" — and the app applies it to every Organize. My
instruction is mine: where it conflicts with a built-in rule, mine wins.

The Dump is the record; the Note is a view. I know that an edit I make by hand in Obsidian
lasts until the next Organize, and that anything worth keeping belongs in the Dump — the app
tells me this instead of surprising me with it.

## User Stories

1. As a user capturing a second thought about something I dumped before, I want the app to fold it into that thought's existing Dump, so that one idea lives in one place.
2. As a user, I want an Append to rewrite the whole Note — body and title — from everything I have captured into it, so that the Note reads as one organized thought rather than a concatenation of dated sections.
3. As a user, I want every capture preserved verbatim inside the target Dump as a dated section, so that the original phrasing of every thought survives no matter how the Note is later re-organized.
4. As a user, I want the merge into the Dump to happen only when I confirm Append, so that choosing "New note" instead leaves the earlier thought's Dump exactly as it was.
5. As a user, I want the Note's filename to stay the same even when the re-organize changes the title, so that wikilinks in my other Notes never break.
6. As a user, I want the Note's `source` to keep pointing at its one accumulated Dump, so that I can always find the raw captures behind any Note.
7. As a user, I want a failed Organize to leave my existing Note exactly as it was, so that a network error never costs me a good Note.
8. As a user, I want to retry an Append after a failure without re-capturing, so that the merged Dump — already saved — is simply organized again.
9. As a user, I want Related links recomputed every time a Note is organized, whether at first save or on an Append, so that the links always describe what the Note is about now.
10. As a user, I want Related links to point only at Notes that exist in my Vault, so that I never tap a dead link.
11. As a user, I want Related links found by content and not by title alone, so that a personal note about the same subject in different words is still found.
12. As a user, I want links that no longer fit dropped when a Note's subject drifts, so that a drifting Note does not carry stale connections.
13. As a user, I want Related links written into the target Note on the Append path — not computed and discarded — so that an Append leaves the Note's connections as fresh as its body.
14. As a user, I want to write one standing Instruction in Settings, so that every Note is organized the way I want without me restating it each time.
15. As a user who captures in one language and reads in another, I want my Instruction (e.g. "always in English") applied on every Organize, so that a Note never drifts back to the Dump's language after an Append.
16. As a user, I want my Instruction to win over the app's built-in organizing rules when the two conflict, so that a deliberate override (e.g. "suggest next actions") actually sticks.
17. As a user, I want my Instruction to shape only how the Note is rendered — not which Note an Append matches, nor which Notes are Related — so that a style preference can never corrupt the vault's connections.
18. As a user, I want a manual Re-organize that rebuilds the Note from its Dump — body and title — so that I can fix a bad Organize myself.
19. As a user, I want my existing Notes left untouched until I append to them, so that the rework never rewrites my Vault behind my back.
20. As a user appending to an old-format Note, I want its old dated sections absorbed like any other content, so that the first Append brings it to the new shape without me doing anything.
21. As a user on the phone, I want the same Append behavior in the PWA as on the desktop, so that both devices agree on what a Note is.
22. As a user, I want the append suggestion itself to keep working as it does today, so that the judgment of new-vs-append stays as good as it is.
23. As a user, I want unchanged Notes to stay served from the embedding cache, so that appends stay fast and cheap as my Vault grows.
24. As a user, I want the capture preview to keep working as today for new Notes, so that founding a Note is unchanged by the rework.
25. As a user, I want an interrupted or failed Append never to write a half-organized Note, so that my Vault never holds something worse than what was there before.

## Implementation Decisions

- **ADR-0009 governs**: one Dump per Note accumulating dated sections; Append = merge into
  the Dump, then one wholesale Organize call; the Note is a view of its Dump; filenames are
  frozen at creation. ADR-0001 (LiveSync CouchDB direct), ADR-0002 (whole-Vault read,
  managed-only writes), and ADR-0003 (OpenAI-compatible provider) all still apply — no new
  storage format, no new provider surface.
- **Operation layer** (append path rewrite): on a confirmed Append, (1) merge the new
  capture into the target Note's Dump file — a dated `## Appended <date>` section after the
  original content, verbatim, including its Context if any; (2) run one Organize call over
  the whole accumulated Dump; (3) resolve Related for the new Note; (4) write the Note to its
  frozen path via the existing read-modify-write with 409 retry. The merge write happens
  first and is the point of durability: after it, the Dump is the saved source of truth.
- **Note format**: the per-section `_Source:` line retires; `## Appended` sections retire
  from Notes (they remain inside Dumps, which is a different thing). `source` frontmatter
  stays a single wikilink to the one Dump. The existing body/sections split parser keeps
  reading old-format files; no migration pass exists.
- **Filename frozen**: an Organize of an existing Note always writes the original path even
  when the title changes; the slug going stale is accepted as cosmetic. Only a founding
  Note computes a path from its title.
- **Organizer prompt**: loses the dead `related` field (Related is resolved by the app, per
  the Related design — the model never invents links); gains an Instruction parameter,
  placed verbatim after the faithfulness block and before the Dump content. Where an
  Instruction conflicts with a built-in rule, the Instruction wins.
- **Instruction setting**: one global free-text field in the Settings Sheet, stored with the
  rest of Settings (device-local, per the existing settings store), empty by default,
  multi-line, passed verbatim on every Organize call — initial, Append, and manual
  re-organize. It never reaches the matcher or the Related judge.
- **Manual Re-organize** becomes a full re-organize: the same path as Append's re-organize
  minus the Dump merge — regenerate body, title, tags, summary, category, key points from
  the Dump, then recompute Related. It replaces the old metadata-only refresh.
- **Related**: recomputed on every Organize and the results written into the Note on the
  append path (closes finding 07 — links were computed then discarded). Links may be dropped
  when the Note's subject drifts. Thresholds (similarity floor, cap) and the hybrid
  embedding-then-judge pipeline are unchanged; the subject remains the organized Note's
  title + summary + body.
- **Matcher unchanged**: the new-vs-append judgment and its prompt are untouched.
- **Confirm-before-merge**: the capture holds the append decision until the user confirms,
  as today; the autosave guard that no-ops an unconfirmed Append still applies. Choosing
  "New note" writes a fresh Dump and leaves the target Dump untouched.
- **Settings schema**: one new string field on Settings, defaulting to empty; validated and
  saved by the existing Settings flow. Plaintext in IndexedDB alongside the rest — no new
  storage.

## Testing Decisions

- **A good test asserts external behavior at the seam, never internals**: what file the
  vault holds after the operation, what the fake Organizer received, what the saved Note
  contains — not which private function called which.
- **Seam A — the operation layer, black-box** (existing): deterministic fake
  Matcher/Organizer/Relater plus in-memory PouchDB, exercising `matchNote` → capture session
  → finalize → append/organize as today's append tests do. This seam already observes every
  new behavior: the Dump merge (dated section, verbatim, before the Note is touched), the
  single Organize call over the accumulated Dump, the frozen path under a changed title,
  Related written on the append path, merge-only-after-confirm, the old Note intact when the
  Organize fails, and 409 retry preservation.
- **Seam B — the prompts** (existing): the organizer prompt builder asserted as prompt text
  — Instruction placed verbatim after the faithfulness block, `related` field gone — the way
  the faithfulness and provider tests already assert prompt text.
- **Settings** follow the existing settings-store test pattern for the new field (default,
  persistence, validation pass-through).
- **Expected churn**: tests asserting the old contract flip to the new one — "never
  overwrites the user's existing edits to the Note body" becomes "regenerates the body from
  the Dump"; "does not refresh the Note metadata" becomes "rewrites the frontmatter". This is
  the contract changing, not the tests getting weaker.
- Prior art: the append/operations/related test files for Seam A; the faithfulness and
  provider tests for Seam B.

## Out of Scope

- **No migration** of existing Notes or Dumps — old-format Notes take the new shape the
  first time they are appended to; their old dated sections are absorbed by the re-organize.
- **No rename machinery** — no rewriting of inbound wikilinks, ever; filenames are frozen.
- **No change to the Matcher or Related judge prompts**, the similarity floor, the link cap,
  the embedding input shape, or the embedding cache.
- **No per-note Instructions, no preset toggles** — one global free-text field.
- **No in-app Note editing** — hand edits stay in the user's editor and remain provisional
  by design; no edit-preservation diffing.
- **No backlink/reverse-link feature** — Obsidian's Linked mentions remains the reverse
  direction.
- **No change to Pending/Stranded semantics** for founding captures.

## Further Notes

- The domain language for this rework is already recorded in `CONTEXT.md` (Dump, Note,
  Organize, Append, Related, Instruction) and the decision rationale in **ADR-0009**;
  the two are the source of truth for *why*, and this spec for *what an agent should build*.
- The glossary sentence "an edit made directly to a Note is provisional" is a user-facing
  contract, not just an internal rule — any UI copy about appending or editing may need to
  say it.
- Dogfooding finding 07 in the findings log should be marked resolved by this spec, not by a
  patch to the old append behavior — the old behavior no longer exists after this rework.
- Each append costs one organize call over the whole accumulated Dump; prompt length grows
  with the Note. Accepted at personal-vault scale (ADR-0009, Consequences).
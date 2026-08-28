# 08 — The Settings sheet

**What to build:** Settings as the fourth full-screen sheet, reached from the grid and returned
to it like every other. The connection checks and the two existing fieldsets carry over
unchanged in substance.

It also becomes the home for the one thing that deliberately has no card: a **Dismissed**
**Dump**. Dismissing means "stop telling me about this", so a Dismissed Dump must not sit on the
grid — but it must stay reachable, because dismissing is a note to self and never
destructive.

**Blocked by:** 02, 03

**Status:** done

- [x] Settings is a full-screen sheet reached from the grid and returned to it
- [x] The two existing fieldsets are present and save together
- [x] Connection checks report reachable or needs-attention with words, never colour alone
- [x] Dismissed Dumps are listed
- [x] A Dismissed Dump can be restored
- [x] Restoring one returns it to the **Stranded** band on the grid
- [x] Nothing in this sheet writes to the **Vault** on the user's behalf

## Comments

Settings is a fourth native modal `<dialog class="sheet">`, reached from the grid's nav the
way Capture, Note and Ask are. The whole old `view === 'config'` panel — the two fieldsets, the
single **Save settings** action, the connection checks, the Stranded reconcile and the
diagnostics — moved into the sheet's body unchanged in substance. What is new is the home for a
Dismissed Dump, appended between the Stranded section and the diagnostics.

Dismissed already shipped before this ticket: `DismissedStore` (`dismiss`/`list`/`restore`) and
the grid's "Dismiss" button landed with the Stranded work (ticket 03), and `deriveStranded`
already excluded dismissed ids. Ticket 08 only adds the Settings-sheet surface to *list* and
*restore* them — the store and the exclusion were already there.

The testable seam is `findDismissedDumps` (operations.ts): it reads the same `VaultState` the
grid pass builds and runs `deriveStranded` with the membership inverted — *include* only
dismissed ids, where the grid and `findStrandedDumps` *exclude* them. To avoid duplicating the
reason cascade, `deriveStranded` was refactored from a hardcoded exclude-pending+dismissed
filter into a predicate parameter; `notExcluded(pendingIds, dismissedIds)` names that predicate
once for both call sites. Each Dismissed Dump carries the reason it stranded for, oldest first.
Covered at Seam A by `tests/pending.test.ts` (4 new tests, black-box with the in-memory PouchDB
stand-in): lists dismissed Dumps oldest-first with reasons; keeps a still-stranded non-dismissed
Dump off the Dismissed list; drops a dismissed Dump a live Note has since cited (filed after the
dismissal); and the restore round-trip — restore returns it to the Stranded band and off the
Dismissed list. `restoreDismissed` calls `dismissed.restore(id)` then re-derives `findStranded`
so the grid's Stranded band shows it again — the Dump was never gone, only silenced.

The Dismissed list is lazy: it populates on **Show dismissed Dumps**, not on sheet entry. This
mirrors the existing **Find stranded Dumps** control beside it — both are Vault reads, and
neither runs until asked. "Listed" reads as "available in the sheet", the way Stranded already
is.

The view has no seam, deliberately. `scripts/shot-settings.mjs` seeds the device-local card cache
(so the grid paints a real card) and the settings store (so the fieldsets render filled), and
points CouchDB at a dead port (so the Vault read rejects and the cached card is kept), then
clicks the real nav "settings" control to open the app's own sheet. The `full` state injects the
result blocks (connection checks, the Stranded list, the Dismissed list, diagnostics) into the
real, already-open sheet body — they render against the actual app.css — because a real
reconcile needs CouchDB + an LLM + an embedder, none available headless. The behaviour behind
them is tested at Seam A.

## Verification

- `npm run typecheck` — 0 errors, 0 warnings (svelte-check, 415 files).
- `npx vitest run` — 217 passed, 10 skipped (was 213, +4 `findDismissedDumps` in `pending`).
- `node scripts/shot-settings.mjs` — 8 screenshots (`form`/`full` × desktop 1280×900 / phone
  390×844 × light/dark), all metrics correct (modal sheets covering the viewport; `form` 2
  fieldsets + Save + no results; `full` 2 fieldsets + Save + 3 connection checks + 3 Stranded +
  3 Dismissed + 3 diagnostics; focus on `.sheet__close` in every shot). Verified by the vision
  subagent: every shot shows the full sheet top-to-bottom (fieldsets, Save, and — for `full` —
  connection checks, stranded list, dismissed list, diagnostics at the bottom), nothing cut off,
  no layout breakage across both widths and both schemes.

## Code review (two-axis)

Standards — no hard violations (no CODING_STANDARDS.md / CONTRIBUTING.md; the ADRs govern
architecture, not function-level conventions). Two judgement-call smells were fixed: the
reason cascade was duplicated verbatim in the Stranded and Dismissed list rows → extracted into
a shared `strandedRowHead(s)` snippet (the action buttons, which differ per list, stay in the
caller); and the `!pendingIds.has(id) && !dismissedIds.has(id)` membership predicate was inlined
twice → named once as `notExcluded`. Two were left as-is by design: the vestigial `view`
variable (Speculative Generality) is explicitly ticket 10's to delete, and the screenshot
script's hand-mirrored markup constants (Duplicated Code) are an acknowledged, drift-flagged
visual utility whose behaviour is covered at Seam A.

Spec — one criterion needed an interpretation, recorded here so it is adjudicable. Criterion 7
("Nothing in this sheet writes to the Vault on the user's behalf") was read as forbidding
*silent* Vault writes — not forbidding the explicit, user-pressed buttons that carried over
unchanged. Save persists the device-local settings (not the Vault); the new Dismiss/Restore-
dismissed touch only the device-local dismissed set; and the carried-over Stranded Organize /
Restore-deleted do write to the Vault, but only at an explicit button press. The comment above
`openSettings` now states this honestly rather than overclaiming "nothing writes to the Vault".
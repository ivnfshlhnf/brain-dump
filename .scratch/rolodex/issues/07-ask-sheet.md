# 07 — The Ask sheet

**What to build:** **Retrieve** on its own full-screen surface. The question at the top, the
synthesized answer below it, then the **Notes** the answer was drawn from shown as cards —
the same cards as on the grid, tappable into the Note sheet.

Citations as cards matter: the user checks an answer against their own words, and the fastest
way to do that is to recognize the Note visually and tap it.

Mirrors Capture — drop in, focus, return.

**Blocked by:** 02

**Status:** done

- [x] A dedicated full-screen surface takes a question in plain language
- [x] The synthesized answer appears with the Notes it cited shown as cards
- [x] A cited card taps through into the Note sheet
- [x] With an empty **Vault**, the Ask entry point is dimmed rather than offered
- [x] The sheet is reached from the grid and returns to it

## Comments

The Ask sheet is a third native modal `<dialog class="sheet">`, reached from the grid's nav the
way Capture is. Sheets do not nest: opening Ask sets `sheet = 'ask'`; a cited card calls
`openNote(path)`, which sets `sheet = 'note'`, replacing the Ask dialog — the user drops from the
answer straight into the Note it drew on, and `close` on either sheet returns to the grid.

The testable seam is `citedCards` (operations.ts): it reads the cited Notes through the same
`readVaultFiles` the grid uses and projects them through the same private `toCard`, so a citation
card is grid-identical — the same category, summary, tags, and hue. It drops a citation whose Note
was soft-deleted between the answer and the read (`readVaultFiles` excludes `deleted: true` by
default) rather than showing a dead link, and returns `[]` for no citations. Covered at Seam A by
`tests/ask-sheet.test.ts` (3 tests, black-box with the in-memory PouchDB stand-in). The answer
itself comes from the existing `retrieve` (covered by `tests/retrieve.test.ts`).

The dimming rule (story 60): the nav Ask control is `disabled` with `class:nav-dimmed` once the
cards have loaded and there are none — an empty Vault can't answer, so the control is offered
faded rather than clickable, with a title explaining why.

The view has no seam, deliberately. `scripts/shot-ask.mjs` seeds the device-local card cache (so
the grid paints a real card and Ask is enabled) and points CouchDB at a dead port (so the read
rejects and the cached card is kept), then clicks the real nav Ask control to open the app's own
sheet. The synthesized answer and its citation cards are injected into the real, already-open
sheet body — they render against the actual app.css — because a real answer needs CouchDB + an
LLM + an embedder, none available headless. The behaviour behind them is tested at Seam A.

## Verification

- `npm run typecheck` — 0 errors, 0 warnings (svelte-check, 415 files).
- `npx vitest run` — 213 passed, 10 skipped (was 210, +3 `ask-sheet`).
- `node scripts/shot-ask.mjs` — 8 screenshots (`field`/`answer` × desktop/phone × light/dark),
  all metrics correct (modal sheets covering the viewport; `field` focused on the textarea with no
  answer; `answer` showing 2 citation cards). Verified by the vision subagent: modals cover the
  viewport, focus ring visible on the field, answer + sources + 2 cards with category colour
  accents present and intact across both widths and both schemes.

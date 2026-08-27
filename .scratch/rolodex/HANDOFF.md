# Handoff — the Rolodex fidelity cutover

Written 2026-08-27, at the end of the session that ran the fidelity audit and landed the
hotfix. Everything below is decided; branch 2 has not been started.

Branch: **`rolodex-11-fidelity-hotfix`** (3 commits ahead of `rolodex-10-promote-grid-to-home`).
Working tree clean, `svelte-check` 0 errors, 230 tests pass.

## The finding

An `/impeccable audit` compared the shipped app against the prototype and DESIGN.md. The
**architecture** of the Rolodex was built faithfully — grid-as-home, four non-nesting sheets, a
card per thought, Category as a closed set hued by index, Pending/Stranded pinned and hue-less,
the status line's three permitted kinds. Every checkable user story is satisfied.

The **visual world** is still the Field Notebook's. `src/app.css` runs on `--ember` / `--set` /
`--alarm` over a teal-navy ground with a 3–4px radius scale; DESIGN.md describes a near-neutral
`#15161b` ground, a single blue `#6ea8d8` accent, and an 8–11px scale. The direction was adopted
in `64ef0a7` but only half executed: the documents moved, the stylesheet did not.

Four documents say the palette was supposed to go — ADR-0006, `.scratch/rolodex/spec.md`,
DESIGN.md, and `docs/design/field-notebook.md` (whose opening line, *"The implementation is
gone"*, is currently false and becomes true when branch 2 lands).

**The full report, with all 24 findings, severities and file locations, is at
`.impeccable/audit/2026-08-27T04-40-00Z__rolodex-fidelity.md`. It is the work list — read it
first. There is deliberately no spec and no tickets (see Q6 below).**

## Decisions taken (a `/grill-with-docs` session, all settled)

| | Decision |
|---|---|
| Q1 | **DESIGN.md is the design authority.** The stylesheet is what's wrong. Rejected rewriting DESIGN.md to match the code, and rejected treating `prototype.html` as authority. |
| Q2 | The palette-independent P1s were fixed first, on their own branch. **Done.** |
| Q3 | Screenshot verification changes: viewport shots, never element-scoped, whenever position or chrome is being verified. **Done** — the rule is in `AGENTS.md`. |
| Q4 | **A raw Dump is set in serif**, not mono. The type system encodes *whose words these are*, not how finished they are. Currently mono on Pending/Stranded cards (`app.css`, `.card__title--raw`) while the capture field is serif — the app contradicts itself. Fix rides branch 2. |
| Q5 | **Adopt DESIGN.md's token names** — `--accent`, `--filed`, `--stranded`, `--pending`, `--surface`, `--sheet`, `--text-mid`, `--cat-*`. `--ember`/`--set`/`--alarm` retire with the design that named them. State colours named after `CONTEXT.md` terms can be checked against the glossary; `--alarm` can't be checked against anything. |
| Q6 | **No spec, no tickets.** The audit is the work list. There is no domain design left to settle and no test seam to drive, so `/to-spec` → `/to-tickets` would restate the audit with worse locations. |
| Q7 | The Ask-sources fix rode the hotfix (trivial); the three-grid merge waits for branch 2 (it re-opens how Pending/Stranded pin within one grid, which is layout judgement). |
| Q8 | DESIGN.md corrected **in place**; ADR-0006 gained a *Clarification*. Rejected a "departures from the prototype" appendix — a design doc describes the design, it doesn't diff itself against a superseded mockup. **Done.** |
| Q9 | **"Wet" names exactly one state** — a Note just filed, still inside the intervene window. A Dump being worked on is *Organizing*; one captured with no Note is *Pending*. Wet stays **out of `CONTEXT.md`**: it's a view state the Vault cannot observe. **Done.** |
| Q10 | The verification rule lives inline in `AGENTS.md`, not a separate `docs/agents/` file. One rule doesn't earn a file. **Done.** |
| Q11 | **Branch boundary: visual system vs missing pieces.** Branch 2 asks *"does this look like DESIGN.md?"*; branch 3 asks *"is everything DESIGN.md describes actually present?"* |
| Q12 | Done means: the shot scripts re-run and read against DESIGN.md, the token table compared directly, and a permanent `var()` guard. **Guard is done** (`npm run check:tokens`). |

## What landed this session

**`c21ee4d` docs** — DESIGN.md: Hold *cancels* (it still described the prototype's pause,
contradicting the spec and the code); Pending/Stranded pinning recorded, including that they pin
*within the one grid*; "wet" split per Q9. ADR-0006: Clarification appended. `CONTEXT.md`
untouched.

**`3bc9bf8` fix** — the status strip had no chrome at all (`--hairline`, `--surface`, `--ink`
referenced, defined nowhere; a `var()` with no fallback voids the whole declaration, so border
*and* background were dropped, and an alert was pixel-identical to a receipt). Moved above the
grid, where both DESIGN.md and the spec put it — at the foot it sat below every card, so the
capture confirmation fired off-screen. `FILEDBrain Dump/…` separated, structurally. Cited
sources stack full-width as `.citations`.

**`3f1baa7` build** — `scripts/check-tokens.mjs`, wired into `npm run build`. The two shot
scripts that photographed elements now photograph viewports. `AGENTS.md` gains the rule.

## Branch 2 — `rolodex-11-palette-cutover`

*"Does this look like DESIGN.md?"*

1. **The token layer as ONE commit.** A half-swapped palette — some surfaces amber, some blue —
   is worse than either endpoint and there's no review value in seeing it. Palette, radius ladder
   (3–4px → 3–11px), spacing ladder (`.25/.5/.75/1/1.5` → `.2/.5/.7/.85/1`), type scale, both
   schemes, DESIGN.md's names.
2. Then, separately: 3px → **1px** card left edge (DESIGN.md has an explicit *Don't* about this);
   pill chip → 3px lowercase (`app.css`, `border-radius: 9999px`); the card's full 1px border
   removed ("the rest of the card is open"); `+N more` → accent; the raw Dump → **serif** (Q4);
   three `.grid` containers → one with pinned ordering.
3. Rewrite the stale *"The app is a press… ember … set"* header at `src/app.css:1–22`.

## Branch 3 — polish

*"Is everything DESIGN.md describes actually present?"*

The two stacked full-width controls and the dashed **Catch a thought…** entry point (the design's
signature affordance — currently a small amber `Capture` button); tag chips (currently bare text);
the idle status message *"all filed · nothing pending"*; primary sub-labels (serif italic beneath);
the dashed *your original words* box in the Capture preview (**verified genuinely absent from the
real component**, not just the fixture); mono uppercase dates (currently `toLocaleDateString()`);
the `brain`·`dump` wordmark; `⌘K` / `⌘,` / arrow-key grid nav (`App.svelte:469` currently returns
early on *any* modifier, so the documented chords are actively excluded); `open in obsidian →` as a
foot action; `auto-fill` grid track sizing.

## Open question — decide before branch 2

**Five of the seven `scripts/shot-*.mjs` inject hand-written replicas of the component markup
instead of driving the real component**, and `shot-note` / `shot-capture` replace an entire sheet
body. They drift silently: `shot-ask` went on photographing a `.grid` container through a whole
fix because the real markup had moved to `.citations` and nothing connects the two. It was caught
only because the screenshot *didn't change when it should have*.

The replicas do use the app's real CSS, so the shots stay honest about **styling**; it is
**structure** they can lie about. That's why the audit still holds — its styling findings came
from real CSS, and its structural findings were verified against source directly.

This matters for branch 2 because the cutover will be verified almost entirely through these
scripts. The replicas are a deliberate choice (they avoid a live LLM), so reworking them is real
work and probably its own ticket. Not decided.

## Gotchas

- **Node 22 is required.** The build throws `crypto is not defined` under 18. Sourcing nvm resets
  PATH *after* your prepend — use the direct path:
  `export PATH="$HOME/.nvm/versions/node/v22.17.1/bin:$PATH"` and check `node -v` first.
- **`npm run check:tokens`** after any CSS change. Run against the commit before this branch it
  reports all four dead references and exits 1.
- **`detect.mjs` cannot see palette drift behind a `var()`** — it only inspects literal colours,
  and reported this codebase's palette as clean while the palette was wrong. "Detector is clean"
  must not be read as "matches DESIGN.md"; the token table needs comparing directly.
- The prototype renders with `git archive prototype/rolodex .scratch/rolodex/prototype | tar -x -C <dir>`
  then Playwright against `prototype.html`. It reads the system scheme, so pass
  `colorScheme: 'dark'` to compare against the app's dark shots.
- `.scratch/shots/` is gitignored; the shot scripts themselves are committed.

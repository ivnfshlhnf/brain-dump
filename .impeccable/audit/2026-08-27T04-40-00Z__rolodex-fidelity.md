# Audit — Rolodex fidelity: the shipped app vs the proposed prototype

**Date:** 2026-08-27 · **Branch:** `rolodex-10-promote-grid-to-home` (`main..HEAD`, 11 commits)
**Subject:** `src/App.svelte`, `src/app.css`
**Reference:** `DESIGN.md` (root, the Rolodex system) · `.scratch/rolodex/spec.md` (the buildable spec,
which supersedes the prototype) · `prototype/rolodex` branch — `prototype.html` + 17 mockups
**Method:** token and CSS diff against DESIGN.md; the app's own `scripts/shot-*.mjs` renders compared
surface-by-surface against Playwright renders of `prototype.html` (desktop 1280 / phone 390, dark and
light); `scripts/detect.mjs`; computed-style verification in Chromium for anything that looked wrong.

---

## Implementation Integrity Verdict

**Pass on architecture. Fail on the visual world.**

The Rolodex's *information architecture* was built faithfully and well: the grid is the only
persistent surface, four sheets drop over it and return, a card is a thought (Note, Pending,
Stranded), Category is a closed set hued by index via the golden angle, `uncategorized` correctly
takes no hue, Pending and Stranded pin to the top and carry no Category hue, and the status line
carries exactly the three kinds the spec allows. Every user story in the buildable spec that I could
check against a render is satisfied. That is the hard half and it is done.

The *visual world* is still the Field Notebook's. `src/app.css` runs on `--ember` / `--set` /
`--alarm` over a teal-navy ground (`oklch(21% 0.028 235)`), with a 3–4px radius scale and a
`.25/.5/.75/1/1.5rem` spacing ladder. `DESIGN.md` at the repo root describes a different system
entirely: a near-neutral `#15161b` ground, a single blue accent `#6ea8d8`, `filed` / `stranded` /
`pending` state colours, an 8–11px radius scale and a `.2/.5/.7/.85/1rem` ladder. The Rolodex's
category-hue system was grafted on top of the Field Notebook's chassis rather than replacing it.

This is a documented instruction that was half-executed. The buildable spec says:

> The Rolodex design files move from the prototype branch to the repo root and replace the Field
> Notebook's. The Field Notebook's design record is kept as a superseded document; **its
> implementation is deleted.**

The files moved (commit `64ef0a7`). The implementation was not deleted. `DESIGN.md` therefore
documents a palette, type scale, spacing ladder and radius scale that the app does not implement —
which means the design system has stopped being a description of the code and become a description
of an intention.

**The consequence that matters most:** DESIGN.md's *One Voice Rule* — "the blue accent is the only
state colour" — is inverted in the shipped app. Amber (`--ember`) is the primary button fill, the
global focus ring, the burn-edge countdown, the `NEW NOTE` eyebrow and the Ask field's focus border.
Blue never appears. Someone reading DESIGN.md to make a change would reach for the wrong colour on
their first edit.

---

## Audit Health Score

| # | Dimension | Score | Key Finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | 3 | Genuinely good baseline (aria-live, inert sheets, 44px floor, word-with-colour). Not independently swept — see confidence note. |
| 2 | Performance | 3 | Nothing alarming surfaced; one keyframe animation, reduced-motion respected. Not independently swept. |
| 3 | Theming | 1 | Four `var()` references are never defined and ship dead; the whole palette contradicts DESIGN.md. |
| 4 | Responsive Design | 3 | Breakpoints and touch targets are sound; Ask's cited-source grid collapses inside the sheet. |
| 5 | Implementation Integrity | 2 | Coherent, product-specific — but coherent with the *superseded* design record. |
| **Total** | | **12/20** | **Acceptable — significant work needed** |

**Confidence note.** This audit was scoped to *fidelity against the prototype*, which is what was
asked. Accessibility and Performance are scored on evidence that surfaced incidentally while doing
that, not on a dedicated contrast sweep or a profiling run. Treat those two scores as provisional; a
full `/impeccable audit` with no fidelity scope would be the way to firm them up.

---

## Executive Summary

- Audit Health Score: **12/20** (Acceptable)
- **24 differences catalogued.** Severity: **0 P0 · 4 P1 · 15 P2 · 5 P3**
- Separately, **6 differences are deliberate, spec-mandated overrides and are not defects** — see
  "Correctly overridden" below. They are listed so nobody 'fixes' them back toward the prototype.

**The five that matter:**

1. The status strip ships with **no chrome at all** — four undefined tokens.
2. The status strip renders **below the entire card grid**, not above it.
3. The **palette, radius scale and spacing ladder** are the Field Notebook's, contradicting DESIGN.md.
4. `FILEDBrain Dump/2026-08-21-....md` — the filing stamp and the path **run together**, no space.
5. The **dashed "Catch a thought…" control is absent** — the design's signature affordance and the
   entry point to the whole product is a small amber `Capture` button.

---

## Detailed Findings by Severity

### P1 — Major

#### [P1] The status strip's entire visual treatment is dead
- **Location:** `src/app.css:536–543, 571`
- **Category:** Theming
- **Evidence:** `--hairline`, `--surface` and `--ink` are referenced four times and **defined
  nowhere** in the project (`grep` over `src/`, `index.html`, `public/` returns only the four use
  sites). Confirmed by computed style in Chromium: `border-style: none`, `border-left-width: 0px`,
  `background-color: rgba(0,0,0,0)`.
- **Impact:** A `var()` with no fallback makes the whole shorthand invalid at computed-value time, so
  `border: 1px solid var(--hairline)` and `border-left: 3px solid var(--hairline)` both resolve to no
  border, and `background: var(--surface)` to transparent. The strip renders as bare floating text.
  Worse: `.status-strip--alert` sets `border-left-color` on a border whose width is `0` and style is
  `none`, so **`connection-lost` and `config-rejected` are visually identical to a capture
  confirmation**. The only thing distinguishing an alert from a receipt is the sentence itself.
- **Why the shot script missed it:** `scripts/shot-status.mjs:170` screenshots
  `page.locator('.status-strip')` — the element in isolation. An element-scoped screenshot of an
  element with no background and no border looks exactly like a correct one.
- **Recommendation:** Define the three tokens, or point them at the existing ones
  (`--rule` / `--raised` / `--text`). Then give the three kinds the distinct treatments DESIGN.md
  specifies: caught = filed tint + border, connection = dashed neutral, rejected = stranded tint.
- **Suggested command:** `/impeccable harden`

#### [P1] The status strip renders below the whole card grid
- **Location:** `src/App.svelte:1215–1224` (after `</section>`, last child of `main`)
- **Category:** Implementation Integrity
- **Evidence:** `main` is a plain column flex with no `order` (`src/app.css:241–247`), so DOM order is
  visual order. The strip is emitted after the grid section closes.
- **Impact:** Both sources place it above the grid. DESIGN.md: "a thin strip under the controls".
  The buildable spec: "a single persistent strip on Home, **below the two controls and above the card
  grid**". As shipped, the capture confirmation appears below every card in the Vault — on any grid
  taller than the viewport it is off-screen at the moment it fires. That defeats story 47 ("As
  someone who just captured, I want a brief confirmation that it landed, so that I can leave
  immediately without wondering"), which is the entire reason the strip exists.
- **Recommendation:** Move the `{#if strip && !sheet}` block inside `.grid-surface`, directly after
  `.grid-controls`.
- **Suggested command:** `/impeccable layout`

#### [P1] The palette, radius scale and spacing ladder are the Field Notebook's
- **Location:** `src/app.css:48–162`
- **Category:** Theming
- **Evidence:**

  | Token | DESIGN.md (Rolodex) | Shipped |
  |---|---|---|
  | ground (dark) | `#15161b` near-neutral | `oklch(21% 0.028 235)` teal-navy |
  | surface | `#1e2026` | `oklch(25% 0.03 235)` |
  | primary accent | `#6ea8d8` blue | `--ember` `oklch(75% 0.15 65)` amber |
  | filed / stranded / pending | `#56a890` / `#d65a4a` / `#64656d` | `--set` / `--alarm` / — |
  | card radius | `11px` | `4px` |
  | button radius | `8–9px` | `3px` |
  | spacing ladder | `.2/.5/.7/.85/1rem` | `.25/.5/.75/1/1.5rem` |
  | light ground | `#faf9f7` warm | `oklch(97% 0.008 240)` cool |

- **Impact:** DESIGN.md is no longer a description of the code. Every visual decision taken from it
  will be wrong on the first try. The One Voice Rule ("blue is the only state colour, used on ≤10% of
  any screen") is inverted — amber carries the primary button, the focus ring, the countdown and the
  eyebrow, and blue is absent from the app entirely.
- **Note:** `scripts/detect.mjs` cannot see this. It only checks *literal* colours, and every one of
  these is behind a `var()`, so the detector reports a clean palette while the palette is wrong.
- **Recommendation:** This is the root cause of roughly half of everything below and should be decided
  before any of the P2s are touched. It is a **direction decision, not a bug fix** — see "The decision
  this audit is really asking for".
- **Suggested command:** `/impeccable colorize` (after the direction is settled)

#### [P1] The filing stamp and the vault path run together
- **Location:** `src/App.svelte:1389–1390`
- **Category:** Implementation Integrity
- **Evidence:** Renders as `FILEDBrain Dump/2026-08-21-water-the-plants.md` in
  `.scratch/shots/note/full-desktop-dark.png`. `<span class="filed-mark">Filed</span>` is followed
  directly by the `<a class="vault-link">` with no explicit separator.
- **Impact:** The first line of the Note sheet — the thing that tells the user their thought reached
  the Vault, story 40 — reads as a typo. It also undercuts DESIGN.md's `FILED TO OBSIDIAN` stamp,
  whose copy the code comment at `src/app.css:762` still describes but which the markup renders as
  just `Filed`.
- **Recommendation:** Put an explicit separator between them (a `·`, or `gap` with
  `display: inline-flex`), and reconcile the copy with the comment.
- **Suggested command:** `/impeccable clarify`

### P2 — Minor

| # | Finding | Location | DESIGN.md says | Shipped |
|---|---|---|---|---|
| 5 | Card left edge is 3px | `app.css:1024` | 1px — and an explicit **Don't**: "Don't add a coloured `border-left` above 1px on a filed card. The 1px category edge is the card's whole identity." | `3px`, defended in a code comment on alignment grounds. Detector-confirmed (`side-tab`). |
| 6 | Category chip is a pill | `app.css:1070` | `3px` radius; "**Nothing is pill-shaped**"; chips lowercase | `border-radius: 9999px`, `text-transform: uppercase`. Detector-confirmed (`design-system-radius`). |
| 7 | Tags have no chip treatment | `app.css:1114–1122` | "Tag: neutral mono — `tag-bg` fill, `tag-fg` text, `3px` radius" | Bare mono text in a flex row; no fill, no radius, no `#` prefix |
| 8 | Ask's cited source cards collapse | Ask sheet | Cited cards read as grid cards; prototype stacks them full-width | They inherit `.grid` (`repeat(4,1fr)`) inside a 620px sheet, so titles wrap to five lines and ~55% of the panel is empty |
| 9 | Three separate `.grid` containers | `App.svelte:1137,1157,1189` | One grid; "the grid reads as a true index, not a feed"; cards uniform height | Pending, Stranded and Notes each get their own grid, so a lone Pending card wastes 3 of 4 columns and bands cannot share row height |
| 10 | The dashed capture control is absent | `App.svelte:1093` | "The capture control is a `1.5px dashed` inviting border — the only place a heavy dashed stroke is used, **and it is the entry point for the whole product**"; two stacked full-width controls reading "Catch a thought…" and "Ask your notes…" | Two small side-by-side buttons labelled `Capture` and `Ask`; the primary is an amber fill |
| 11 | No idle status message | `App.svelte:1215` | "Idle reads `all filed · nothing pending`, centred, in `text-dim`" | `{#if strip && !sheet}` — nothing renders at idle |
| 12 | "Your original words" box missing from the preview | Capture sheet | "The verbatim Dump sits in a dashed *your original words* box, expandable to add Context while wet" | No dashed box and no verbatim Dump in the preview; only an `ADD CONTEXT` label and a plain textarea |
| 13 | Primary buttons have no sub-label | `app.css:391–396` | "Primary: … Plex Mono 600 uppercase 0.72rem, **with a serif italic sub-label beneath at 0.7 opacity**" | Single-line sentence-case label (`Save now`, `Ask`, `Append`) |
| 14 | Wordmark | `app.css:325–332` | `brain`·`dump` — the `b` in `--tx`, the rest in `--tx-mid`, with a middot | `brain-dump`, one weight, one colour, hyphen |
| 15 | `+N more` is not accent-coloured | `app.css:1124–1126` | "`+N more` (accent text, no chrome)" | `color: var(--text)` — reads as bold body text, not an affordance |
| 16 | Dates are locale-numeric | `App.svelte:1145,1183` | Label style: mono uppercase, tracked (prototype: `AUG 24 · 14:02`) | `toLocaleDateString()` → `8/21/2026` |
| 17 | `⌘K` / `⌘,` not implemented | `App.svelte:469` | "Keyboard: `⌘K` Ask, `⌘,` Settings, `Esc` close sheet, arrows move the grid" | Bare `c` / `a` / `s`; line 469 **returns early if any modifier is held**, so the documented chords are actively excluded. No arrow-key grid navigation. |
| 18 | The raw Dump is set in mono | `app.css:1147–1152` | Two Voices Rule: serif is for "words you read"; the capture field itself is serif at 1.25rem | Pending/Stranded card titles use `--mono`. Internally inconsistent: the same words are serif while being typed and mono once on a card. |
| 19 | Cards carry a full 1px border | `app.css:1020` | "No other border; the rest of the card is open" | `border: 1px solid var(--rule)` on all four sides |

### P3 — Polish

| # | Finding | DESIGN.md says | Shipped |
|---|---|---|---|
| 20 | Grid track sizing | `repeat(auto-fill, minmax(180px, 1fr))`, `.6rem` gap, 2 cols ≤560px at `.5rem` | Fixed `repeat(2/3/4, 1fr)` at 36rem/52rem, `.75rem` gap |
| 21 | Type scale | display 1.3rem, headline 1.15, capture 1.25, body 0.86, label 0.7 | `--text-xs` .6875 / `-sm` .8125 / `-base` 1 / `-lg` 1.125rem |
| 22 | Note sheet foot | Two actions: `re-organize note` and a ghost `open in obsidian →` | Only `Re-organize`; the Obsidian door exists but only as the path link in the eyebrow |
| 23 | In-place edit on the preview | "Contenteditable fields … `1.5px` accent box-shadow ring on focus + a faint accent tint" | Not implemented; the preview is read-only apart from Add Context |
| 24 | Sheet copy | Prototype: `CATCH A THOUGHT` / `← cancel` | `before it files` / `close`. Not fixed by DESIGN.md; the app's copy is arguably better. Listed for completeness only. |

---

## Correctly overridden — do not "fix" these

Six differences from `prototype.html` are deliberate and mandated by the buildable spec or DESIGN.md.
They are correct as shipped:

1. **`queued` / `failed` → `Pending` / `Stranded`.** `CONTEXT.md` names the prototype's words as ones
   to avoid. The app uses the domain terms.
2. **Retry and Dismiss on the Stranded card.** Stories 15 and 16. The prototype had no card actions.
3. **Pending and Stranded pinned to a top band.** Story 13. The prototype let them sit chronologically.
4. **Hue from the Category's index, not a string hash.** The spec replaced the prototype's hash
   explicitly, and the golden-angle implementation is faithful.
5. **No theme toggle in the masthead.** The prototype has one; DESIGN.md removed it deliberately
   ("The theme follows the system rather than a toggle").
6. **Hold cancels the timer rather than pausing it.** The spec rejected a resumable countdown by name
   and states the autosave module needs no new interface. The app matches the spec, not the prototype.

---

## Patterns & Systemic Issues

**One pattern explains most of this list: the design record was replaced, the stylesheet was not.**
Findings 3, 5, 6, 7, 10, 13, 14, 15, 19, 20, 21 and 24 are all the same event — the Field Notebook's
visual system surviving a direction change that was supposed to delete it. Fixing them one at a time
would be twelve arguments about the same decision. Fixing the token layer first collapses most of
them.

**A second, smaller pattern: element-scoped screenshot verification hides context bugs.**
`shot-status.mjs` screenshots the strip element alone, which is why neither the dead chrome (P1 #1)
nor its position at the bottom of the page (P1 #2) was caught by ticket 09's own verification. Every
other `shot-*.mjs` captures a viewport and did not have this blind spot. Worth a rule: verify a
component in its page, not on its own.

**A third: `src/app.css`'s header comment still describes the Field Notebook.** Lines 1–22 open with
"The app is a press … exactly two accents carry it: ember … set". That is the superseded direction,
stated as current fact at the top of the file an agent reads first.

---

## Positive Findings

Worth keeping and worth saying plainly:

- **The architecture is right.** Grid-as-home, four non-nesting sheets, a card per thought, the
  reconcile-on-open read, the projection cache that never gates capture — all of it matches the
  buildable spec, and the hard parts (ADR-0007's cache, the Stranded reasons) are handled.
- **The category-hue system is the best-implemented thing here.** Hue by index stepped by the golden
  angle, lightness/chroma per scheme, hue passed per card as an inline custom property, `uncategorized`
  correctly hue-less. It does exactly what the spec asked and it is genuinely elegant.
- **Accessibility was taken seriously.** `aria-live` on the strip and the recovery banner, `inert` on
  the backdrop, a 44px touch floor on committing rows, focus-visible rings, `prefers-reduced-motion`
  handled, and every state carrying a word rather than a colour alone.
- **The code comments are unusually good.** Nearly every non-obvious rule explains *why*, including
  the ones I disagree with — the 3px border and the mono raw-Dump both state their reasoning, which
  is what made this audit possible to do honestly rather than by guesswork.
- **The empty and edge states exist and are calm.** The ghost placeholder, the dimmed Ask, the four
  distinct recovery messages that were deliberately not collapsed into one.

---

## The decision this audit is really asking for

Before any fix, one question has to be answered, because ~15 of the 24 findings depend on it:

**Is the Field Notebook's palette the intended look of the Rolodex, or is DESIGN.md the intended look?**

- If **DESIGN.md is right**, the token layer needs replacing and about half this list disappears with
  it. That is a real, contained piece of work: `src/app.css:48–162`, then the component styles that
  reference the old names.
- If **the shipped palette is right** — and it is defensible; the teal-navy ground and amber accent
  are a finished, coherent system that survived nine Impeccable passes — then **DESIGN.md is wrong and
  should be rewritten to describe what exists**, keeping only the Rolodex's genuinely new parts
  (category hue, the card, the sheets, the status line). The findings that are *not* palette-dependent
  (P1 #1, #2, #4, and P2 #8–#12, #16, #17) still stand either way.

What is not defensible is the current state, where the document and the code describe two different
products.

---

## Recommended Actions

In priority order. The first two are independent of the direction decision and should happen
regardless.

1. **[P1] `/impeccable harden`** — define or re-point `--hairline`, `--surface`, `--ink`; give the
   status strip's three kinds their distinct treatments; fix the `FILEDBrain Dump/…` run-together.
2. **[P1] `/impeccable layout`** — move the status strip above the grid; merge the three `.grid`
   containers into one with pinned ordering; fix the cited-source cards in the Ask sheet.
3. **[decision] Settle DESIGN.md vs the stylesheet** — see above. Nothing below should start first.
4. **[P1] `/impeccable colorize`** — *only after 3*: bring the palette to whichever side won, and make
   the burn edge, focus ring, eyebrow and primary fill agree with it.
5. **[P2] `/impeccable shape`** — the two stacked controls and the dashed "Catch a thought…" entry
   point; the "your original words" dashed box in the preview.
6. **[P2] `/impeccable typeset`** — tag chips, the `brain`·`dump` wordmark, mono uppercase dates,
   accent `+N more`, primary sub-labels.
7. **[P2] `/impeccable adapt`** — the `⌘K` / `⌘,` chords and arrow-key grid navigation.
8. **[P3] `/impeccable polish`** — the residue: radius and spacing ladders, the `open in obsidian →`
   ghost action, and the stale Field Notebook header comment at `src/app.css:1–22`.

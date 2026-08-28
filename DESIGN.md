---
name: brain·dump — Rolodex
description: A self-sorting card index that files itself; color is category, blue is state.
colors:
  background: "#15161b"
  surface: "#1e2026"
  surface-2: "#16181d"
  sheet: "#101116"
  rule: "#23252d"
  rule-soft: "#2a2d36"
  dashed: "#393c46"
  text: "#e4e4e8"
  text-mid: "#9a9aa4"
  text-dim: "#888a93"
  text-faint: "#5a5c66"
  accent: "#6ea8d8"
  accent-ink: "#0c0d10"
  filed: "#56a890"
  stranded: "#d65a4a"
  pending: "#64656d"
  cat-0: "oklch(0.66 0.12 30)"
  cat-1: "oklch(0.66 0.12 167.5)"
  cat-2: "oklch(0.66 0.12 305)"
  cat-3: "oklch(0.66 0.12 82.5)"
  cat-4: "oklch(0.66 0.12 220)"
typography:
  display:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "1.3rem"
    fontWeight: 600
    lineHeight: 1.15
  headline:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "1.15rem"
    fontWeight: 600
    lineHeight: 1.2
  capture:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "1.25rem"
    fontWeight: 400
    lineHeight: 1.5
  body:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "0.86rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "0.7rem"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "0.08em"
rounded:
  xs: "3px"
  sm: "5px"
  md: "7px"
  lg: "8px"
  xl: "9px"
  2xl: "10px"
  3xl: "11px"
spacing:
  xs: "0.2rem"
  sm: "0.5rem"
  md: "0.7rem"
  lg: "0.85rem"
  xl: "1rem"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.xl}"
    padding: "0.75rem"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text-mid}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0.6rem"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-mid}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0.55rem 0.7rem"
  icon-button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-mid}"
    rounded: "{rounded.lg}"
    size: "30px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.3xl}"
    padding: "0.7rem 0.78rem 0.78rem"
  chip:
    backgroundColor: "rgba(217,138,58,0.18)"
    textColor: "#e0a866"
    typography: "{typography.label}"
    rounded: "{rounded.xs}"
    padding: "0.1rem 0.42rem"
  input:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.3xl}"
    padding: "0.8rem 0.9rem"
  status:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-dim}"
    typography: "{typography.label}"
    rounded: "{rounded.xl}"
    padding: "0.5rem 0.7rem"
---

# Design System: brain·dump — Rolodex

## Overview

**Creative North Star: "The Self-Sorting Rolodex"**

The surface is a self-sorting index of cards — one card per Note — that the app files on the
user's behalf. The grid is home; everything else is a full-screen sheet you drop into and
return from. The person this is for is lazy, forgetful, and in and out in seconds, so the
interface is built to be glanced at, recognized, and left. Capture friction is the only
unforgivable failure; every other decision bends to it.

Spartan and nocturnal. Dark by default, surfaces nearly monochrome at rest — the ground, the
cards, and the rules are all close in value, so the page reads as a quiet field until
something moves. Two things move: the **category hues** (one per card, the only place color
spends freely) and the single **blue accent** (the Organizing state, the just-filed card, the
Ask entry point, and the Ask answer). Everything else — dates, paths, tags, labels, buttons — stays neutral
monospaced metadata. Restraint is the default; color is spent deliberately, never
decoratively.

The trade that defines the direction: the source project's strict two-accent discipline is
exchanged for **category recognition**. Color encodes category, not state; state collapses to
one blue. This is a real, deliberate loss of restraint, bought for scanability — a category
is recognizable at a glance across the grid. Tags are many and fine, but they stay neutral
mono, so forty tags never become forty hues. One color per card, capped to the category set.

**Key Characteristics:**
- Dark-first, near-monochrome at rest; category hue + blue accent are the only motion.
- Serif (Newsreader) for the words you read; monospace (IBM Plex Mono) for the metadata you scan.
- The grid is the constant; four focused sheets (Capture, Ask, Note, Settings) drop over it and return.
- Color is category (8 stable hues, deterministic per category); blue is the one state color.
- Tactile, confident affordances: dashed inviting capture, crisp focus rings, definite hover.
- Cards uniform in height; the new card slotting into the grid *is* the filed receipt.

## Colors

Plain functional names. Values below are the **dark (default) theme**; the paired light theme
follows as a complete set. State colors are separate from category hues — state is one blue,
category is eight hues.

### Primary
- **Accent** (#6ea8d8, oklch(0.710 0.093 244.6)): the one state color. The Organizing status
  fill, the just-filed (**wet**) card's ring, the Ask entry point and answer surface, focus
  rings, the countdown, the capture-field caret and selection, hover accents on controls. Saturated against the
  near-monochrome ground, which is the point — it is the only thing that signals "active."
  Used on ≤10% of any screen; its rarity is its signal.

### Secondary (state, not category)
- **Filed** (#56a890, oklch(0.673 0.089 172.2)): a teal-green, the success/filed state only —
  the FILED stamp, the "filed to obsidian" confirmation, related-link titles, the green status
  dot. Never a category hue.
- **Stranded** (#d65a4a, oklch(0.623 0.160 29.7)): a Dump the app stopped working on — the
  Stranded card's left border and its retry action. Carries a softer text variant
  (`--stranded-tx #e09a8e`) for copy on dark. The glossary's word: never "failed".
- **Pending** (#64656d, oklch(0.509 0.013 280.3)): a Dump captured but not yet filed — the
  dashed Pending card. A near-neutral slate; state, not category. Being Pending is ordinary and
  says nothing is wrong, so it is deliberately the quietest state in the system.

### Tertiary (category hues — the only decorative color)
One hue per **Category**, derived from the Category's **position** in the closed set — never
hashed from its string (ADR-0008). The hue steps by the golden angle:

```
hue = (index * 137.5 + 30) mod 360        at a fixed lightness and chroma per theme
```

The same Category is always the same hue, the user never picks a color, and appending a
Category leaves every existing hue untouched. There is no palette to maintain and no ceiling on
how many Categories may exist. Each hue drives a card's 1px left border and its single Category
chip (a translucent `-bg` tint + a lighter `-fg` text variant, so the chip reads on both themes).

- **0 troubleshooting** (h 30) · **1 productivity** (h 167.5) · **2 tools** (h 305)
- **3 coffee** (h 82.5) · **4 personal** (h 220)
- **uncategorized**: no hue. It takes the neutral Tag treatment — the absence of a Category is
  not a color.

**The list is append-only and its order is load-bearing.** Sorting it re-colors every Note in
the Vault and raises no error.

### Neutral
- **Background** (#15161b): the ground behind everything.
- **Surface** (#1e2026): grid cards, controls, icon buttons — the resting card.
- **Surface-2** (#16181d): tinted panels — the note/preview card body, settings fieldsets, the
  ask field, Pending cards. One step darker than the grid card, which is how panels separate
  from the grid without shadows.
- **Sheet** (#101116): full-screen sheet backdrop, one step darker again.
- **Text** (#e4e4e8): primary text. **Text-mid** (#9a9aa4): summaries, secondary labels.
  **Text-dim** (#888a93): dates, section labels, the idle status. **Text-faint** (#5a5c66):
  placeholders, ghost-card copy, the proto badge — decorative/disabled only.
- **Rule** (#23252d): 1px hairline dividers. **Rule-soft** (#2a2d36): button borders.
  **Dashed** (#393c46): the inviting dashed capture border and Pending/Stranded card edges.

### Light theme (paired set)
The light theme is the same system on paper, not a separate one. Background `#faf9f7`,
surface `#fff`, surface-2 `#f2f1ee`, sheet `#fff`. Text ramps to `#2a2a2a` / mid `#6a6a6a` /
dim `#737373` / faint `#a0a0a0`. Accent deepens to `#3a5a8a` (it must carry more weight on
white), filed to `#22745a`, stranded to `#c0392b`, pending to `#9a9a8e`. Category hues use the
same golden-angle positions at a darker lightness and higher chroma — `oklch(0.48 0.13 h)` in
place of dark's `oklch(0.66 0.12 h)` — so a Category keeps its identity across themes while
carrying enough weight on paper. Their chips drop to a 0.14 alpha tint. The Organizing status inverts: a 0.1 accent tint with
accent text and a 1px accent border, instead of the solid accent fill used in dark.

### Named Rules
**The One Voice Rule.** The blue accent is the only state color and is used on ≤10% of any
screen. Its rarity is the point; spreading it thin is failure.
**The Category-Not-Decoration Rule.** Hue is spent only on category — a card's 1px left border
and its single chip. Tags, buttons, and body text stay neutral mono. Forty tags never become
forty hues.
**The Word-With-Color Rule.** State color always rides a word (the status message, the FILED
stamp, the dot + label). Never color alone — the status line is `aria-live` and every state is
legible without hue.

## Typography

**Display Font:** Newsreader (with Georgia, serif) — an opsz variable serif; weights 400/500/600 + italic 400.
**Body Font:** Newsreader (same family).
**Label/Mono Font:** IBM Plex Mono (with ui-monospace, monospace) — weights 400/500.

**Character:** A quiet editorial pairing. Newsreader carries the words you actually read —
titles, the capture field, note bodies, answers — with the warmth of a serif but tuned small
and tight so it scans rather than lingers. IBM Plex Mono carries the metadata you scan and
dismiss — dates, paths, tags, labels, buttons, status — in a calm monospaced voice. The
contrast between "words to read" (serif) and "metadata to scan" (mono) is the whole type
system; nothing else varies much.

### Hierarchy
- **Display** (Newsreader 600, 1.3rem, lh 1.15): the note title — the opened Note and the
  preview card. The largest serif on the surface.
- **Headline** (Newsreader 600, 1.15rem, lh 1.2): sheet headings (`h2`).
- **Capture** (Newsreader 400, 1.25rem, lh 1.5): the capture field — the single most important
  typographic moment, a full-screen serif input where the thought lands. Italic placeholder.
- **Body** (Newsreader 400, 0.86rem, lh 1.55): note bodies, summaries (`--tx-mid`), answers
  (0.95rem). Measure stays inside the 620px sheet so lines stay 65–75ch.
- **Label** (IBM Plex Mono 500, 0.7rem, lh 1.35, tracking 0.08em, uppercase): section labels,
  chips, tags, dates, buttons, status, the wordmark. The metadata voice. Tracking widens
  0.04–0.1em by role (section labels widest, status tightest at 0.02em).

### Named Rules
**The Two Voices Rule.** Serif is for words you read; mono is for metadata you scan. If a
string is read for meaning it is Newsreader; if it is scanned and dismissed it is Plex Mono.
No third family, no display sans.
**The Small Scale Rule.** The scale is deliberately tight (0.7rem→1.3rem). The surface is an
index, not a book; large display type would reward lingering, which the user does not do.

## Layout

A single 920px-max column (`.app`, centered, `0 .7rem 3rem` padding). Inside it: a sticky
slim masthead, two stacked controls (Catch / Ask), the status line, then the responsive card
grid. The grid is `repeat(auto-fill, minmax(180px, 1fr))` with a `.6rem` gap; at ≤560px it
collapses to two equal columns at a `.5rem` gap. Cards are uniform height — title, a 2-line
clamped summary, up to three tag chips + a `+N more`, and a date pinned to the bottom — so the
grid reads as a true index, not a feed.

**Pending and Stranded cards pin to a band at the top**, ahead of the Notes, which follow in
reverse chronological order. The pinning is required by the domain rather than chosen for
looks: Stranded is defined as always surfaced, and chronological placement makes that promise
false the moment the Vault outgrows one screen. They pin *within the one grid* — the band is an
ordering, not a second grid — so cards stay uniform and no row is left half-empty.

Four full-screen sheets (Capture, Ask, Note, Settings) slide up over the grid
(`transform: translateY(100%) → 0`, `.28s`) and return to it; the grid never scrolls into a
sub-page. Each sheet centers a 620px-max inner column with a top bar, a scrolling body, and a
footer action stack. Density is calm: section gaps `.7rem`, control padding `.85rem`, sheet
body padding `.4rem 1rem 1.2rem`.

Spacing rhythm is a loose rem scale (`.2 / .5 / .7 / .85 / 1rem`); it is not a strict token
ladder, applied by feel to keep groups tight and sections separated (more space above a
section label than below it).

## Elevation & Depth

Soft ambient lift. Surfaces are flat at rest with a single 1px hairline shadow
(`0 1px 3px rgba(0,0,0,.4)` dark / `rgba(0,0,0,.08)` light), and depth is conveyed mostly by
**tonal layering** — ground / sheet / surface / surface-2 are four close value steps that
separate planes without shadows. Shadows appear as a *response to state*: a card hover lifts
`translateY(-2px)` and gains a diffuse `0 4px 12px rgba(0,0,0,.25)`; the wet (just-filed) card
takes a `0 0 0 2px accent inset` ring rather than a drop shadow. Sheets slide rather than
drop-shadow. Focus is a 2px solid accent ring (`outline-offset: 2px`), not a glow.

### Shadow Vocabulary
- **Resting** (`0 1px 3px rgba(0,0,0,.4)`): the default on cards and the note panel. Barely
  there; it just lifts the card off the ground.
- **Hover lift** (`0 4px 12px rgba(0,0,0,.25)`, light `.12`): on an interactive card hover,
  paired with `-2px` translate. The only place a diffuse shadow appears.
- **Wet inset** (`0 0 0 2px var(--accent) inset`): the just-filed/highlighted card. A ring, not
  a shadow.

**Wet names exactly one state**: a Note just filed, still inside the window where the user can
intervene — the ink has not dried. A Dump the app is still working on is **Organizing**, and a
Dump captured with no Note yet is **Pending** (`CONTEXT.md`). The word used to cover both ends
of that journey, which made it useless at either; it now covers only the filed end. Wet is a
view state and deliberately not in the glossary — the Vault cannot tell a Note filed four
seconds ago from one filed last week.

### Named Rules
**The State-Only Lift Rule.** Shadows respond to state (hover, wet), never decorate a resting
surface. Tonal layering separates planes; shadows confirm interaction.

## Shapes

Calm, rounded rectangles with a hairline category border. Corners climb a small scale: chips
and tags `3px`, kbd/badges `5px`, inputs `7px`, buttons and icon buttons `8px`, primary
buttons and the status/dump blocks `9px`, settings checks `10px`, cards and panels `11px`.
Nothing is pill-shaped and nothing is sharp. The card's signature silhouette is a rounded
rectangle with a **1px left border in its category hue** — that single colored edge is the
card's identity. Pending cards trade it for a `2px dashed` neutral left edge; Stranded cards for
a `1px` stranded-red left edge — neither carries a Category hue, so state and Category never
compete for the same signal. The capture control is a `1.5px dashed` inviting border — the only
place a heavy dashed stroke is used, and it is the entry point for the whole product.

## Components

Tactile and confident. Controls sit low-contrast at rest and respond definitely when
approached — a hover shifts border and color to the accent, a focus draws a crisp 2px accent
ring. The dashed Catch border invites; buttons have real borders and a definite press. The
primary action is the only saturated control; category color is confined to a card's 1px
border + chip and never touches a button.

### Buttons
- **Shape:** rounded `9px` (primary) / `8px` (secondary, ghost); flat, no shadow.
- **Primary:** accent fill (`#6ea8d8`) + accent-ink text, `0.75rem` padding, Plex Mono 600
  uppercase 0.72rem, with a serif italic sub-label beneath at 0.7 opacity. The only saturated
  button; used once per footer (SAVE, APPEND, RETRY).
- **Secondary / Ghost:** transparent with a `1px rule-soft` border, `text-mid` text, `8px`
  radius; hover brightens text to `--tx` and border to `--tx-dim`. Ghost is the same, slightly
  tighter padding, used for the trailing link action (open in obsidian →).
- **Hover / Focus:** border + color shift to accent over `.15s`; focus = 2px accent ring.

### Chips
- **Category chip:** Plex Mono 0.7rem, `3px` radius, the category's translucent `-bg` tint
  with its lighter `-fg` text — one per card, colored by the Category's position.
- **Tag:** neutral mono — `tag-bg` fill, `tag-fg` text, `3px` radius, `0.7rem`. Up to three on
  a card, then `+N more` (accent text, no chrome) that opens the Note.
- **State chip:** Pending and Stranded cards swap the Category chip for a neutral or
  stranded-tinted label.

### Cards
- **Corner:** `11px`.
- **Background:** `surface` (filed) / `surface-2` (Pending, Stranded).
- **Border:** a `1px` left edge in the Category hue (filed), `2px dashed` neutral (Pending),
  `1px` stranded-red (Stranded). No other border; the rest of the card is open.
- **Shadow:** resting hairline; hover lift (see Elevation).
- **Internal padding:** `0.7rem 0.78rem 0.78rem`; uniform height via clamped 2-line summary
  and date pinned `margin-top:auto`.
- **Wet state:** `0 0 0 2px accent inset` ring + a `slotin` entrance animation (translateY
  `-8px` + scale `.985` → none, `.42s` cubic-bezier(.2,.7,.2,1)) — the new card slotting in is
  the filed receipt.

### Inputs / Fields
- **Capture field:** transparent, borderless, full-width serif at 1.25rem — the page *is* the
  input. Italic placeholder in `text-faint`.
- **Ask field / context input:** `surface-2` fill, `1px rule` border, `11px`/`7px` radius;
  focus shifts border to accent (no glow). Inputs are quiet until focused.
- **Contenteditable fields** (in-place edit on the preview): a `1.5px` accent box-shadow ring
  on focus + a faint accent tint background; a faint tint on hover signals editability.

### Status line
- The app's one global voice — `aria-live="polite"`, a thin strip under the controls. Plex Mono
  0.72rem, `9px` radius, a 7px dot + message + optional action + a clear `×`. It carries only
  what belongs to no card — **three** kinds: **caught** (filed tint + border, the brief capture
  confirmation), **connection** (dashed neutral, lost or restored), and **rejected** (stranded
  tint + border, a settings rejection). Caught fades after ~3s and leaves nothing behind — the
  card slotting into the grid is the receipt. The other two hold until cleared or resolved, and
  every message can be cleared immediately.

  **Pending and Stranded deliberately do not appear here.** They have their own cards, and the
  rule this strip is written under is that state belongs on the thing it is about. Idle reads
  "all filed · nothing pending", centered, in `text-dim`.

### Navigation
- A sticky slim masthead: Plex Mono wordmark (`brain`**·**`dump`, `b` in `--tx`, rest in
  `--tx-mid`) at left; the settings gear at right. The theme follows the system rather than a
  toggle, so the masthead carries no appearance control. Icon buttons are `30px` squares, `8px` radius, `1px rule` border,
  `text-mid` → accent on hover. The two grid controls (Catch · Ask) are the primary nav;
  sheets return to the grid. Keyboard: `⌘K` Ask, `⌘,` Settings, `Esc` close sheet, arrows move
  the grid, Space/Enter toggle-hold/commit in the capture preview.

### Signature: the Burn Edge
The new-note preview carries a 3px accent edge bar at its top that drains left-to-right over
5s (`@keyframes burn` width 100%→0) — a literal countdown to auto-save. **Hold cancels the
countdown; it does not pause it.** The edge stops and stays stopped, and the only thing that
files the Note after that is the user pressing the primary action — a clock the user stopped
never restarts behind them. An unconfirmed Append holds the edge full from the start and never
auto-saves at all. The edge is the clock. It is the one authored motion moment and it carries
information (time-to-commit), not decoration.

## Do's and Don'ts

### Do:
- **Do** spend color only on category (card border + chip) and the one blue accent (state).
  Everything else is neutral mono.
- **Do** derive a Category's hue from its position in the closed set; the same Category is
  always the same hue, and the user never picks a color.
- **Do** keep the grid the constant and every focused moment a full-screen sheet that returns
  to it — one thing on screen at a time.
- **Do** let the new card slot into the grid be the filed receipt; the caught status fades and
  leaves nothing behind.
- **Do** pair every state color with a word (the status message, the FILED stamp); the status
  line is `aria-live` and must read without hue.
- **Do** lift cards only on state (hover `−2px` + diffuse shadow; wet = accent inset ring);
  rest flat with the hairline shadow.
- **Do** trap focus in sheets (`inert` on the grid/controls/mast and non-open sheets) and
  restore it on close; leave the status line live so capture reassurance still announces.
- **Do** use Plex Mono for metadata you scan and Newsreader for words you read — and nothing
  else.

### Don't:
- **Don't** use category hue on buttons, tags, or body text. Tags stay neutral mono; buttons
  stay accent or neutral.
- **Don't** add a colored `border-left` above 1px on a filed card (a Pending card's 2px is
  dashed neutral, a different signal). The 1px category edge is the card's whole identity.
- **Don't** spread the blue accent thin — it is the only state color and the Organizing/wet/Ask signal;
  using it decoratively destroys its meaning.
- **Don't** use a third type family, or a display sans for headings. Serif reads, mono scans.
- **Don't** let a state color stand alone without a word, or a status hold the user hostage —
  every message, even a failure, carries a dismiss `×`.
- **Don't** animate at rest. The one authored motion is the burn-edge countdown, which carries
  information; entrance motion (`slotin`) is reserved for the just-filed card. Respect
  `prefers-reduced-motion` (collapse to instant).
- **Don't** lose the capture. The capture field is borderless and full-screen; capture friction
  is the only unforgivable failure, and every visual decision defers to it.
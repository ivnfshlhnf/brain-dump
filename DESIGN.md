---
name: Brain-dump
description: A field notebook that files itself — catch a thought wet, let it dry into a Note.
colors:
  wet-ink: "oklch(58% 0.16 55)"
  wet-ink-dark: "oklch(75% 0.15 65)"
  dry-ink: "oklch(52% 0.09 195)"
  dry-ink-dark: "oklch(72% 0.09 195)"
  page: "oklch(97% 0.008 240)"
  page-dark: "oklch(21% 0.028 235)"
  card: "oklch(100% 0 0)"
  card-dark: "oklch(25% 0.03 235)"
  graphite: "oklch(28% 0.02 240)"
  graphite-dark: "oklch(92% 0.012 230)"
  pencil: "oklch(52% 0.02 240)"
  pencil-dark: "oklch(70% 0.018 230)"
  rule: "oklch(88% 0.012 240)"
  rule-dark: "oklch(32% 0.02 235)"
  alarm: "oklch(52% 0.19 25)"
  alarm-dark: "oklch(74% 0.16 25)"
typography:
  display:
    fontFamily: "Newsreader, Georgia, 'Times New Roman', serif"
    fontSize: "clamp(1.15rem, 1rem + 0.9vw, 1.4rem)"
    fontWeight: 400
    lineHeight: 1.5
  title:
    fontFamily: "Newsreader, Georgia, 'Times New Roman', serif"
    fontSize: "clamp(1.4rem, 1.1rem + 1.4vw, 1.9rem)"
    fontWeight: 400
    lineHeight: 1.15
  body:
    fontFamily: "Newsreader, Georgia, 'Times New Roman', serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: "0.6875rem"
    fontWeight: 400
    letterSpacing: "0.06em"
  meta:
    fontFamily: "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    letterSpacing: "0.02em"
rounded:
  sm: "3px"
spacing:
  s1: "0.25rem"
  s2: "0.5rem"
  s3: "0.75rem"
  s4: "1rem"
  s5: "1.5rem"
  s6: "2rem"
  s7: "3rem"
components:
  button-primary:
    backgroundColor: "{colors.wet-ink}"
    textColor: "{colors.page}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 1rem"
    typography: "{typography.meta}"
  button-default:
    backgroundColor: "{colors.card}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 1rem"
    typography: "{typography.meta}"
  nav-tab:
    backgroundColor: "transparent"
    textColor: "{colors.pencil}"
    padding: "0.25rem 0"
    typography: "{typography.meta}"
  nav-tab-active:
    backgroundColor: "transparent"
    textColor: "{colors.graphite}"
    padding: "0.25rem 0"
    typography: "{typography.meta}"
  input-dump:
    backgroundColor: "{colors.card}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.sm}"
    padding: "0.75rem"
    typography: "{typography.display}"
  input-field:
    backgroundColor: "{colors.card}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.sm}"
    padding: "0.5rem"
    typography: "{typography.meta}"
  note-card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.sm}"
    padding: "1.5rem 1rem 1rem"
---

# Design System: Brain-dump

## Overview

**Creative North Star: "The Field Notebook"**

Brain-dump is the pocket notebook you already carry, except it files itself. Someone stops
walking, catches a thought before it goes, and puts it down — and by the time they look
again it has a title, a summary and links to what it belongs with. The world is that
notebook: everyday, portable, personal, made to be written in rather than admired. Nothing
here is a dashboard, a workspace, or a product surface. It is one person's book.

A notebook is a physical object, and this system treats it as one. Pages and cards have
weight and sit on each other; a control that can be pressed looks pressable and behaves that
way; a state change is something you watch happen rather than something you find has
happened. The one drama in the whole app is ink drying: a thought goes down **wet** — still
yours, still editable, five seconds from permanent — and then it is **dry**, in the Vault,
alongside years of notes this app never touched. Those two states carry the only two accent
colours in the system.

Physical does not mean soft. This is a well-made notebook, not a scrapbook: crisp, precise,
exactly aligned, the kind of object whose ruling is dead straight and whose corners are
true. Materials are real and the execution around them is exact. The user reaches for it
mid-sentence and it must never make them look twice.

**Key Characteristics:**
- Two inks, two states: wet means yours, dry means filed. No third accent.
- The machine writes in mono; the person writes in serif.
- Real material — paper, card, stacking, pressing — with instrument-grade precision on top.
- One column, always. This is a book, not a workspace.
- The whole Note is shown before it is committed. Never a summary of itself.

## Colors

A notebook palette: paper, graphite and pencil for everything structural, and exactly two
inks that mean something.

### Primary
- **Wet Ink** (`oklch(58% 0.16 55)`, dark `oklch(75% 0.15 65)`): a thought that is not yet
  permanent. The countdown edge, the primary action, the active tab. Present only while
  something can still be changed. Warm, closer to iron-oxide ink than to a signal orange.

### Secondary
- **Dry Ink** (`oklch(52% 0.09 195)`, dark `oklch(72% 0.09 195)`): a thought that has reached
  the Vault. Saved paths, Related links, Ask citations. Deliberately quieter and cooler than
  Wet Ink — a filed thought does not shout.

### Tertiary
- **Alarm** (`oklch(52% 0.19 25)`, dark `oklch(74% 0.16 25)`): failure only. Rejected
  configuration, error events, failed checks. Never decorative, never a third brand colour.

### Neutral
- **Page** (`oklch(97% 0.008 240)`, dark `oklch(21% 0.028 235)`): the ground the book sits on.
  Cool rather than cream — this is a working notebook, not a keepsake.
- **Card** (`oklch(100% 0 0)`, dark `oklch(25% 0.03 235)`): any surface stacked on the page.
  Notes, fields, answers.
- **Graphite** (`oklch(28% 0.02 240)`, dark `oklch(92% 0.012 230)`): everything written to be
  read.
- **Pencil** (`oklch(52% 0.02 240)`, dark `oklch(70% 0.018 230)`): everything written to be
  glanced at — labels, hints, inactive tabs, metadata keys.
- **Rule** (`oklch(88% 0.012 240)`, dark `oklch(32% 0.02 235)`): the ruling of the page.
  Dividers, borders, section lines.

### Named Rules

**The Two Inks Rule.** Wet Ink and Dry Ink are states, not decoration. If a colour appears
somewhere it does not mean "not yet saved" or "in the Vault", the system is broken. Adding a
third brand accent breaks it too — the vocabulary only reads because it is exactly two.

**The Both Schemes Rule.** Every colour resolves through `light-dark()` with a
`prefers-color-scheme` fallback. A value that only works in one scheme is not finished. Test
both before calling any colour decision done.

## Typography

**Display / Body Font:** Newsreader (variable weight, with Georgia fallback)
**Label / Mono Font:** IBM Plex Mono (400/500, with `ui-monospace` fallback)

**Character:** A working pairing, not a decorative one. Newsreader is warm, readable and
slightly editorial — the hand of the person writing. IBM Plex Mono is engineered and even —
the hand of the machine doing the filing. Set against each other at small sizes with open
letter-spacing, the mono reads as an instrument's markings rather than as code.

### Hierarchy
- **Display** (400, `clamp(1.15rem, 1rem + 0.9vw, 1.4rem)`, 1.5): the capture field. The
  thought being typed is set at reading size in the reading face, because it is the product.
- **Title** (400, `clamp(1.4rem, 1.1rem + 1.4vw, 1.9rem)`, 1.15): a Note's title, and the
  only place type gets large.
- **Body** (400, 1rem, 1.55): a Note's body, summary, key points, and Ask answers. The measure
  caps at 34rem so lines stay readable.
- **Label** (400, 0.6875rem, `0.06em`, uppercase): field labels, eyebrows, section markers.
  Uppercase mono at small size, spaced open enough to read as a marking.
- **Meta** (400, 0.8125rem, `0.02em`): tags, paths, wikilinks, tab names, status lines,
  diagnostics. Anything the machine states as fact.

### Named Rules

**The Two Hands Rule.** The machine writes in mono; the person writes in serif. Labels,
tags, paths, wikilinks, frontmatter keys, timestamps and status are mono. The Dump, titles,
bodies and summaries are serif. There is no third face and no case where a person's words
are set in the machine's hand.

**The Reading Measure Rule.** Body text never exceeds 34rem of measure, on any viewport. A
Note is read, not scanned.

## Layout

One column, centred, capped at `34rem` (`--measure`), on every viewport. The app is a book:
it does not become a two-pane workspace at desktop width, and there is no sidebar to grow
into. Vertical rhythm runs on a seven-step scale — `0.25 / 0.5 / 0.75 / 1 / 1.5 / 2 / 3rem`
(`--s1`…`--s7`) — with `1rem` as the default gap between sibling blocks and `1.5rem`
separating regions.

The page is structured top-down: a masthead carrying the wordmark and three tabs above a
single rule, then the surface's content, then status. Nothing floats, nothing docks, and
nothing is fixed to the viewport.

**Status is the only feedback channel, so it announces itself.** The status line (and the
queue banner) carries `aria-live="polite"`, so a save confirmation, a failure, a config
rejection or an offline-queue notice is spoken to assistive tech the same moment it appears
on screen — the app's one feedback channel is never silent to anyone.

**Observed gap, to be resolved.** At desktop width the content currently occupies roughly the
top sixth of the viewport with empty ground below and nothing anchoring the page. The single
column is correct; its vertical composition is not finished.

## Elevation & Depth

**Committed direction: full tactility.** Surfaces are real material. A Note is a card of
stock resting on the page, with weight and a soft ambient shadow that says how far off the
page it sits. Pressable things lift on hover and depress on press. State changes are watched,
not discovered — every interactive element responds visibly, and the transition between wet
and dry is the one moment worth animating properly.

**Observed state: the Note card has its material; the rest of the surfaces do not yet.**
The Note card now carries a two-layer ambient shadow (`--shadow-card`, an offset close
shadow plus a soft far one, resolved per scheme — darker and more present in dark mode where
the ground itself is dark) and a card radius a step larger than the controls' (`--radius-card`
4px vs `--radius` 3px). Every interactive element has a 140ms `--ease` transition and a real
press depression (`:active` translates 1px). The one authored motion — the wet→dry commit —
cross-fades: the edge fills back to full and the ink turns from Wet to Dry over ~260ms. All
of it falls back to static under `prefers-reduced-motion`, with the colour cross-fade kept
because it carries the state and is not vestibular.

What is still ahead: the tactility floor is in the stylesheet but the other surfaces (the
empty Capture textarea, the Ask box, the Config wall) have not had their own bolder passes —
they still read as generic shells. The `.answer` card still wears its old 2px Dry Ink
`border-left`, an AI-slop tell the detector flags, pending its own pass.

### Named Rules

**The Nothing Moves Silently Rule.** Any element a person can act on acknowledges the action
visibly — hover, focus and press are all distinct. An interface where pressing a control
produces no visible change reads as broken, not as restrained.

**The Reduced Motion Rule.** Every motion respects `prefers-reduced-motion`. Where motion
carries information — the countdown especially — the reduced variant states the same fact in
words or a static mark rather than dropping it.

## Shapes

The current form language is a single corner radius of `3px` (`--radius`) applied uniformly
to cards, buttons and fields, with 1px borders in Rule doing the separating. One radius for
everything was a deliberate simplicity; the second, larger step arrived with the card's
material, so the form language is now two radii — `3px` (`--radius`) for controls and `4px`
(`--radius-card`) for stacked stock — and a card reads as a piece of stock rather than an
over-sized button.

Borders are hairlines. Nothing is clipped to a non-rectangular silhouette anywhere in the
app.

## Components

### Buttons
- **Shape:** barely-softened corners (3px), 1px border, `0.5rem 1rem` padding.
- **Primary:** Wet Ink fill with Page-coloured label, mono at 0.8125rem with `0.02em`
  tracking. Used for the committing action on a surface — Capture, Ask, Save settings.
- **In-flight:** a committing primary names the operation in progress, not a frozen label.
  Capture reads `Capturing…` while the round-trip runs; Ask reads `Reading your vault…`. The
  disabled colour treatment (below) keeps the in-flight state distinct from "nothing typed yet".
- **Default:** Card fill, Rule border, Graphite label. Everything else.
- **Touch-target floor:** the committing row (`.actions`) is held to a 44px minimum height so
  the thumb lands the primary one-handed; a primary and its siblings share one height instead
  of mismatching. The nav tabs are text, not commit buttons, and stay slim.
- **Hover / Focus:** border shifts to Pencil on hover; focus-visible draws a 2px Wet Ink
  outline offset 2px. Both resolve over the 140ms `--ease` beat — they no longer snap.
- **Disabled:** its own colour treatment, not a flat opacity fade. A disabled default control
  drops to the Page fill with a Pencil label and a Rule border — absent, not broken. A
  disabled primary keeps its light label but washes the Wet Ink fill out toward Pencil
  (`color-mix` of ember and pencil), so the action reads as deactivated without becoming a
  ghost. This replaced the old `opacity: 0.45` blanket fade, which read as half-rendered in
  both schemes.

### Inputs / Fields
- **Style:** Card fill, 1px Rule border, 3px radius, mono at 0.8125rem for ordinary fields.
- **The capture field is the exception:** serif at Display size with `0.75rem` padding and a
  9rem minimum height. It is the one field set in the reading face, because the thought is
  the product and not a form value.
- **Focus:** 2px Wet Ink outline, offset 2px.
- **Capture is fast and protected:** the Dump is autofocused on mount (the first character
  needs no tap to reach the field), the in-flight text is persisted to `localStorage` on input
  (debounced 250ms) and restored on the next load so an interrupted thought — a closed tab, a
  killed app, a bus ride — survives where it used to vanish from volatile memory before the
  Capture press, and ⌘/Ctrl+Enter commits from any commit field (Dump, Context, Ask) without
  reaching for the button. The draft is cleared the moment a Dump is actually captured;
  `beforeunload` flushes it synchronously so a sudden close does not lose the last 250ms.
- **Observed defect:** the capture field still renders as a bordered box with a visible native
  resize grabber, which reads as an ordinary form control rather than as a page to write on.

### Navigation
- Three tabs — capture, ask, settings — in lowercase mono at 0.8125rem with `0.04em` tracking,
  right-aligned against the wordmark, separated from the content by a single Rule hairline.
  The third tab is `settings`, not `config`, so the noun matches its own surface — the `Save
  settings` button and the `Settings saved` status line all say the same word.
- **Active:** Graphite text with a 2px Wet Ink underline. **Inactive:** Pencil text,
  transparent underline. Hover lifts inactive text to Graphite.
- The tab row does not change at phone width; three short words fit.

### Note card *(signature)*
The one component the whole design exists for. A Note is shown **complete** before it is
committed — title, tags, category, the full body, summary, key points and Related — not a
summary card standing in for it.

- **Structure:** Card surface, 4px radius (`--radius-card`), a two-layer ambient shadow
  (`--shadow-card`), `1.5rem 1rem 1rem` padding, contents stacked on the `0.75rem` step.
- **Eyebrow:** uppercase mono in Wet Ink stating the pending decision. For a new Note it reads
  `NEW NOTE`. For an append it reads `APPEND TO` followed by the matched Note's title in its
  **own case** — the decision is the machine's marking (uppercased), but the title is a
  person's words and keeps its casing, so `append to "Offline capture and the outbox"` no
  longer becomes `APPEND TO "OFFLINE CAPTURE AND THE OUTBOX"`. Once saved the eyebrow
  becomes the commit, promoted onto the card: a `FILED TO OBSIDIAN` filing stamp (uppercase
  mono, Dry Ink) with the vault path as a live `obsidian://` link below it — the door back
  into the Vault, in the place the decision used to be.
- **Section markers:** small uppercase mono labels — summary, key points, related — each
  trailed by a hairline running to the edge of the card. They are ruling, not headings.
- **The countdown edge:** a 2px Wet Ink hairline across the top of the card, scaling from full
  to zero over the five-second autosave window, restarted whenever Context is edited. The card
  is the clock — but only when the clock is honest. An unconfirmed append never autosaves, so on
  that path the edge is **held**: static, full, Wet, not burning (the `burn--held` state), and
  the hint states the reason in words. On save the edge stops, fills back to full, and cross-fades
  to Dry Ink over ~260ms — the one authored moment, wet to permanent. Under reduced motion the
  edge holds full in either state and only the colour carries the change.
- **Related, when present:** each link is a door back into the Vault — an `obsidian://open`
  link that opens the real Note in Obsidian on this device. The link text is the wikilink's
  target without the `[[ ]]` brackets (the machine states the location, not the syntax);
  external URLs pass through as-is. Dry Ink, no underline at rest, underline on hover — a
  filed link does not shout, and says "follow me" only when reached for. Visited stays Dry:
  a followed link is not a different state here.
- **Related, when empty:** states why in words rather than showing an empty section.
- **Actions:** `Append` / `Save as new Note` resolve an unconfirmed append (the save, on that
  path); `Save now` forces the autosave where one will actually fire; `New capture` returns to
  the empty Dump. After save, `Re-organize Note` re-runs Organize on the saved Note's body to
  refresh its title, tags, summary and category — the term is `Organize`, not "metadata",
  because that is the vocabulary for what it does.
- **Scroll-on-save:** once the commit is promoted onto the card, the card is scrolled to the
  top of the viewport so the peak-end frame is the filed Note itself — not the bottom-of-page
  status line that just scrolled past. Smooth, unless the user has asked motion to stop.

### The Obsidian door

A saved Note is not the end of the journey — it is the seam back into the Vault it came from.
Three places open the real file in Obsidian on this device via `obsidian://open`:

- **The saved path** in the filed line (the commit, promoted onto the card).
- **Every Related link** (wikilink targets become paths; external URLs pass through).
- **Every Ask citation** in the answer's sources.

The URL is `obsidian://open?vault=<name>&file=<path>` when a vault name is set, or
`obsidian://open?file=<path>` when it is empty (Obsidian opens the active vault). Each path
**segment** is percent-encoded but the slashes stay literal — Obsidian's handler reads the
slash as a path separator, so an encoded `%2F` would point at one oddly-named file instead of
a path. The vault name is a **per-device** setting (a vault may be named differently on the
laptop and the phone; it is not the CouchDB database name), so it lives in Settings as
`Obsidian vault name`, defaults to empty, and is not synced. The helpers live in
`src/lib/obsidian.ts` and are unit-tested.

## Do's and Don'ts

### Do:
- **Do** show the whole Note before it is committed — body included. The preview is the Note,
  not a description of it. *(Confirmed as the one thing that must survive any redesign.)*
- **Do** keep Wet Ink and Dry Ink tied to their two states, and add no third accent.
- **Do** set the person's words in the serif and the machine's words in the mono.
- **Do** give every interactive element a visible hover, focus and pressed state.
- **Do** resolve every colour through `light-dark()` and verify both schemes before shipping.
- **Do** respect `prefers-reduced-motion`, and restate in words anything motion was carrying.
- **Do** cap the reading measure at 34rem.

### Don't:
- **Don't** fade a disabled control to a flat `opacity: 0.45` and call it a state.
- **Don't** let the capture field look like a form field. It is a page to write on.
- **Don't** add a second column, a sidebar, or a docked panel. This is a book.
- **Don't** use Wet Ink or Dry Ink decoratively — on a border, a divider, or a heading that
  carries no state.
- **Don't** fetch a font, an icon, or any asset from a CDN. Everything ships self-hosted; the
  offline path is the one that matters most.

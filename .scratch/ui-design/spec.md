Status: in-progress

# UI design

## Problem Statement

The app had no design. `src/app.css` was 80 lines of tidied browser defaults: `system-ui`,
two hardcoded colours, a 32rem column, some padding. There were no design tokens, no type
scale, no focus styling, and no `<style>` block in `App.svelte` at all. This is not a design
to polish — it is the absence of one, which is why the usual objection to visual work
("don't polish a screen you are about to change") carries little weight here. There is
nothing to waste.

It also had a specific interaction problem, found by dogfooding and recorded as finding 01
in `.scratch/dogfooding/findings.md`: the Note preview did not match the Note in the Vault.
The preview rendered four fields — title, summary, key points, tags — while a saved Note is
a document with frontmatter, an H1, a body, three sections and links. `Note.body`, the
substantive part of the file, was never on screen before the Note was written. The user was
being asked to approve a Note they could not see.

## Solution

**The app is a press.** It takes something molten — a Dump, verbatim and unstructured — and
sets it into something permanent, a Note in the Vault. The one moment worth designing is the
transition: the five seconds while the Note is still molten. `CONTEXT.md` already says this,
in that the Dump is frozen once the Note is saved.

**State is the material.** Exactly two accents carry it and neither appears anywhere else:

- **ember** — uncommitted. The Dump, the preview, the countdown.
- **set** (teal) — in the Vault. The saved path, Related links, Ask citations.

**Two faces, no third.** The machine speaks in mono — labels, tags, paths, wikilinks,
frontmatter keys. The thought is set in serif — the Dump you type, titles, bodies,
summaries. The contrast encodes something true rather than decorating: the scaffolding is
the app's job, the thought is yours.

**The preview shows the whole Note**, and after the save it shows the Note that was actually
written rather than the preview that preceded it — so Related links appear where the section
promised them.

**The signature is the countdown.** The five-second autosave window was invisible and
surprising. It is now the Note card's own top edge: an ember hairline that burns down and,
when the Note reaches the Vault, stops, fills, and turns teal. The card is the clock.

## Implementation Decisions

- **Tokens in `:root`, resolved through `light-dark()`** with raw light/dark values kept as
  separate custom properties, plus a `prefers-color-scheme` fallback for browsers without
  `light-dark()`. `color-scheme: light dark` on `:root` and a `<meta name="color-scheme">`
  in the head, so the browser themes its own chrome from the first paint.
- **Self-hosted fonts, not a CDN.** This is an offline-capable PWA with an offline outbox; a
  webfont request is exactly what fails when the app matters most. Newsreader (variable
  wght, latin) and IBM Plex Mono (400/500, latin), both SIL OFL 1.1, licences shipped
  beside them in `public/fonts/`. 108 KB total. Workbox's default globs exclude fonts, so
  `woff2` is added to `globPatterns`.
- **The body is rendered as raw markdown in serif**, `white-space: pre-wrap`, with no
  markdown renderer. This is the honest reading of "show me the file" and adds no
  dependency.
- **The countdown is driven in CSS**, keyed on a revision counter that increments on each
  Context edit, so it restarts exactly when the autosave timer does. This keeps the change
  view-only. `autosave.ts` could expose the remaining time instead, which would be truer;
  do that only if the CSS visibly drifts.
- **No operation-layer code moved.** Capture, Organize, Append, Retrieve and the autosave
  timing are untouched. This is the view.

## Out of Scope

- **Ask and Config markup.** Both inherit the tokens and are legible, but neither has been
  designed. See ticket 02.
- **Changing the five-second window.** The countdown makes it visible; whether five seconds
  is the right number is an interaction question that needs findings, not a design decision.
- **A markdown renderer for the body.**
- **Reverting the second Organize at finalize.** Finding 01's other component — that the
  preview and the saved Note come from two different LLM responses — is untouched here.
  Showing the written Note after the save makes it visible rather than fixing it.

## Further Notes

- **Nobody has seen this yet.** Verification so far is computed styles in a live browser:
  both faces load, `light-dark()` resolves correctly in both schemes, the Dump textarea
  computes to Newsreader and the nav to IBM Plex Mono. The preview snapshot tool failed
  repeatedly, so no screenshot exists. **The Note card in particular has never been
  rendered** — it needs a real Capture, which needs CouchDB and the LLM. The countdown
  burning down, and the ember-to-teal transition at save, are unobserved.
- **This branch is a baseline, not a conclusion.** A second design pass using other tooling
  is planned on a separate experiment branch. The point of comparison is this branch's
  design plan, recorded above.

**Status:** ready

# 03 — Show the preview before Match returns

**What to build:** Render the capture preview as soon as Organize returns; resolve the
new-vs-append Match behind it; arm the autosave timer only once Match has settled.

**Blocked by:** 01 (so the improvement is measured). Independent of 02 — the saving is
structural and holds at any model speed.

## Problem Statement

`startCapture` (`src/lib/operations.ts:339-342`) awaits two chat calls in series before it
returns anything:

```js
const { dump } = await capture(text, deps);
const preview = await organizeNote(dump, deps.organizer, deps.settings);
const match = await matchNote(preview, deps.db, deps.settings, deps.matcher);
```

Logged at **15.2s + 4.9s**, and the sheet shows nothing for the whole of it. But Match changes
nothing the preview renders — it decides whether this Dump founds a new Note or Appends to an
existing one, which the sheet expresses only in its buttons. Every field the user reads is
ready when Organize returns.

The two calls genuinely are sequential: Match takes the preview's title, tags, and summary. So
the fix is not parallelism, it is rendering between them.

## Solution

Split the capture flow so the preview is returned as soon as Organize resolves, with the Match
decision arriving after. The Related section keeps its current placeholder — ticket 04 fills
it.

While Match is unresolved the sheet renders in a settling state: the Note is fully readable
and the Context field accepts typing, and the action row shows that the append decision is
still being made rather than showing `Save now` — a button that would mean something different
once the suggestion lands.

**The autosave timer is armed when Match settles, not when the preview renders.** This is the
whole risk of the ticket. Match has been logged at 4.9s against a 5s timer, so arming at
render is a coin flip on whether the autosave fires before the app knows what saving means —
and `saveAndFinalize`'s guard (`App.svelte:818`) holds an unconfirmed Append only if
`session.match.kind === 'append'`, which a still-pending Match cannot be. The app would found
a duplicate Note, which is the exact failure Match exists to prevent.

The rule the timer now follows: **arm the clock only once everything the user is meant to see
is on screen.** Ticket 04 extends the same rule to Related.

## User Stories

1. As the user, I want to read the organized Note as soon as it exists, so that I am not
   waiting on a decision that changes nothing I can see.
2. As the user, I want to start adding Context immediately, so that the wait for the append
   decision is not also a wait to type.
3. As the user, I want the Append suggestion to still be offered, so that seeing the preview
   sooner does not cost me duplicate Notes.
4. As the user, I want the countdown to start only when there is nothing left to appear, so
   that the clock never runs against a screen that is still changing.
5. As the user, I want the buttons to say what they will do, so that I never press Save on a
   decision the app has not made yet.

## Implementation Decisions

- **The operation layer keeps owning the decision, the UI owns the sequencing.** `matchNote`
  is already exported and already takes its own dependencies; the capture flow returns the
  session with an unresolved match and the caller resolves it. No new module.
- **The session carries an explicit "match not decided yet" state**, distinct from
  `{ kind: 'new' }`. Reusing `new` as the placeholder is what makes the duplicate-Note bug
  possible: the guard cannot tell "decided new" from "not decided".
- **Arming the timer moves out of `captureDump`.** It fires when the match settles, including
  when it settles to `new`.
- **A Match that fails settles to `new`**, matching `matchNote`'s existing behaviour for a
  bad or out-of-range index — a failed match must not strand the capture.
- **The Held and unconfirmed-Append rules are unchanged.** An Append still waits for a tap; a
  Hold still stops the clock; the countdown edge still renders held-full in both cases.

## Testing Decisions

- **Seam A, with a Matcher fake that resolves on demand.** The suite needs to express "the
  preview exists and the match does not yet", which is the whole point of the ticket.
- **The highest-value assertion:** with a Matcher that resolves *after* the autosave delay
  would have elapsed, the capture still offers the Append and does not found a second Note.
  This is the regression this ticket could introduce, and it must be pinned before it can.
- **Pin the ordering:** the preview is available after exactly one Organizer call and zero
  Matcher resolutions.
- **Pin the timer:** no save occurs while the match is unresolved, however long that is.
- **A Matcher that rejects still yields a filed Note**, decided `new`.
- Existing autosave and capture suites must pass unchanged.

## Out of Scope

- The Related section, which keeps its placeholder here — ticket 04.
- Anything after the save fires — ticket 06.
- Parallelising Organize and Match. Match consumes Organize's output; there is no parallelism
  available.

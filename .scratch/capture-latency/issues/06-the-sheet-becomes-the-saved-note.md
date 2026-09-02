**Status:** ready

# 06 — The sheet becomes the saved Note

**What to build:** After a successful save the capture sheet stays open as the filed Note: the
Context field is replaced, the countdown edge plays its wet→dry cross-fade, and the user closes
the sheet themselves.

**Blocked by:** 04 — this only makes sense once the save is a file write rather than a
15-second wait.

## Problem Statement

Today a successful save calls `closeCapture()` and `endSession()` (`App.svelte:848-851`): the
sheet closes and the grid card is the only receipt. Because the save currently takes 15+
seconds, that close happens long after the user pressed anything, with no feedback in between
— dogfooding finding 09.

Ticket 04 removes the wait. What is left is a sheet that vanishes at the moment the Note
reaches the Vault, which throws away the one thing worth showing.

`app.css:872` already describes what should happen there:

> *The Note reaches the Vault: the edge stops, fills back to full, and turns to dry ink. That
> cross-fade is the one moment worth animating — molten to permanent — and it happens exactly
> where the meaning is.*

It has never played. `.committed` is only ever applied to the **Note sheet**
(`App.svelte:1572`) as a static state; the capture sheet always closed just before the moment
arrived. The animation is written, correct, and unreachable.

There is also a state that becomes reachable for the first time: with the sheet open after a
save, the Context field is live against a frozen Dump, and `addContext` throws
`Cannot add Context: the Dump is frozen` (`operations.ts:354`).

## Solution

On a successful save the sheet stays open and changes mode: it stops being a preview the user
can still shape and becomes the Note that is filed.

- The **countdown edge** completes its arc — drained to nothing while the timer ran, then
  refilled and cross-faded to dry ink as the write returns. That is the save's completion
  signal, and the loading feedback finding 09 asked for.
- The **Context field is removed**, not disabled, and the space carries a line saying the Dump
  is frozen and a further capture will Append here. A disabled textarea invites a click that
  means nothing; the field is gone because the thing it did is gone.
- The **sheet is closed by the user.** The grid card and its wet ring still land as they do
  today, so nothing about the grid changes.

The completion signal fires when the **write returns**, never when the button is pressed. A
sheet that says the Note is filed while the write is still in flight would be lying about the
one thing this app promises, and if the write then fails, the Dump is Stranded behind a screen
that said it was saved.

The failure path is unchanged: `held = true`, the status line carries the error, the sheet
stays open, and only Save now files it.

## User Stories

1. As the user, I want to see the Note settle into the vault, so that filing has a visible end
   rather than a disappearance.
2. As the user, I want to be told the Note is saved only once it really is, so that the app
   never claims something it has not done.
3. As the user, I want the Context field to go away once the Dump is frozen, so that I am not
   offered an action that cannot work.
4. As the user, I want to know that another capture will Append here, so that I know what to
   do with the next thought on the same subject.
5. As the user, I want to close the sheet when I am done reading, so that the app does not
   decide for me that I have finished.

## Implementation Decisions

- **The `committed` class comes to the capture sheet.** The CSS exists and needs no change;
  what changes is that the capture sheet's note article gains the class when the write
  returns. The Note sheet keeps it as a static state.
- **Replace the Context field, do not disable it.** `addContext` throwing on a frozen Dump is
  correct and stays correct; the fix is to stop offering the action.
- **The completion signal is driven by the write returning**, not by the button press or the
  timer firing.
- **The grid receipt is unchanged.** `fileOnGrid`, `markWet` and the status line all still
  run; this ticket changes only whether the sheet is torn down with them.
- **`endSession` still runs when the sheet closes**, so the next Capture opens blank. The
  session is settled at save; closing is presentation.
- **`prefers-reduced-motion` is already handled** in the existing rules — the edge holds full
  in either state and only the colour carries wet→dry. Nothing new is needed.

## Testing Decisions

- **This is presentation, and the repo's seam is the operation layer** — so the assertions
  that matter are the ones that already exist: the Note is written once, no other document is
  written, and the Dump is frozen. Those must pass unchanged.
- **Pin the honesty property where it is testable:** a failed finalize leaves the session
  unsaved and Held, and does not report success. That is Seam A and it already has a home in
  the autosave suites.
- **The rest is verified by hand on the phone**, as the app's UI work has been throughout:
  save a capture, watch the edge refill and go to dry ink as the file lands, confirm the
  Context field is gone and the line reads correctly, close the sheet, confirm the card and
  its wet ring are on the grid, and confirm the next Capture opens blank.
- **Check the failure path by hand too** — save with the provider unreachable and confirm the
  sheet stays open, the status carries the error, and nothing claims the Note was filed.

## Out of Scope

- Opening the Note sheet after a save. The capture sheet becomes the Note; there is no
  navigation.
- Any change to the grid, the card, or the wet ring.
- The Append path's own post-save presentation beyond what falls out of this.

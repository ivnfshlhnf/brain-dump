# 05 — The Capture sheet

**What to build:** Capture as a full-screen sheet reached from the grid. One big field, nothing
competing while the user types. Once **Organize** runs, the field yields to the whole **Note**
shown before it is committed — the signature of this product, and the one thing that must
survive any redesign.

The countdown rides the preview card's top edge. **Hold** stops it, and it does not restart:
the user pressed a button specifically to stop a clock, so nothing may start it again behind
them. The only exit from Hold is the user explicitly filing.

When Organize spots that a **Dump** belongs on an existing Note, the sheet makes the **Append**
the primary action and leaves starting a new Note as the quiet secondary. The app files; the
user signs once.

The autosave module gains no new interface — Hold is the existing cancel plus a UI state.

**Blocked by:** 02

**Status:** done

- [x] Catching a thought opens a full-screen field with nothing else on screen
- [x] After Organize, the whole Note is shown before it is committed — not a summary standing in for it
- [x] The countdown is visible on the preview card's top edge
- [x] Hold stops the countdown, and the countdown does not restart on its own
- [x] After Hold, an explicit action files the Note
- [x] **Context** can be added, and the Note is organized from the full Dump
- [x] A suggested Append is the primary action, with starting a new Note available as the secondary
- [x] An unconfirmed Append never files on its own
- [x] Committing returns to the grid with the new card at the top
- [x] Capturing with no connection saves the Dump and says it is waiting — never that it failed
- [x] Leaving a capture uncommitted keeps the Dump and re-surfaces it on the next open
- [x] The autosave module's interface is unchanged

## Comments

**Built.** The Capture sheet is a native modal `<dialog>` opened with `showModal()`, so the
platform supplies what a sheet has to have and the component does not hand-roll it: the grid
behind goes inert (top layer), focus is trapped inside, and every close request — Esc, a
phone's back gesture, an assistive-technology dismiss — arrives as one `close` event, so the
sheet has exactly one way out.

**The old capture view is gone; the grid is the landing surface.** Agreed with the user before
building. Keeping a second capture UI alive until ticket 10 would have meant the sheet's
Hold/commit behaviour existed in one copy and not the other. Ticket 10 still owns the rest of
the cutover: the Ask and Settings views, the nav, and the masthead.

**Two things moved rather than being rebuilt.** The four-state recovery banner moved from the
capture surface onto the grid — a Capture sheet has room for the field and nothing else, and
that banner speaks for the whole app rather than for the thought being typed. Ticket 09
replaces it with the designed status line.

**Re-organize Note is not on any surface right now.** It was the last thing on the old
committed-capture view, and committing now returns to the grid instead of showing a saved
Note. `refreshNoteMetadata` is untouched in the operation layer and still tested; ticket 06's
Note sheet is where it belongs and where it comes back. This is a gap between 05 and 06.

**Hold is the autosaver's existing `cancel` plus a flag.** The module gained no interface —
pinned by a test. The rule that makes Hold mean what it says lives in the view: while held,
neither a Context edit nor declining an Append reschedules the timer, because the user pressed
a button specifically to stop a clock.

**Closing the sheet.** With the countdown running, closing files the Note — the clock was on
screen promising a save. While Held, or with an unconfirmed Append, closing files nothing: the
Dump is already Pending, so it shows on the grid as a Pending card, and `adoptInterrupted`
makes it due for recovery on the next open.

### Verification

- Seam A, `tests/cards.test.ts`: `fileOnGrid` projects a committed Note to the *same card a
  Vault read of that Note produces* (the assertion that makes skipping the re-read safe), puts
  it at the top, caches it so a restart paints it, and leaves an Appended-to Note's card
  untouched with no duplicate.
- Seam A, `tests/autosave.test.ts`: after a cancel, time alone never files the Note however far
  it advances — only an explicit flush does; and the Autosaver exposes exactly
  `schedule`/`flush`/`cancel`.
- Browser, against the running app: the sheet opens from the grid as a real modal
  (`:modal`), covers the viewport, focuses the Dump rather than the close button, traps Tab,
  makes the masthead behind it unhittable, closes on Esc and on the close control, keeps the
  localStorage draft across a close/reopen, and logs no console or page errors.
- `scripts/shot-capture.mjs` (new): the sheet in four states × 2 widths × 2 schemes. The empty
  field state is the real sheet; the review states inject markup mirroring App.svelte, the way
  `shot-grid.mjs` injects cards. Measured: the countdown sits on the preview card's top edge
  (`top: 1px`, `height: 2px`) and runs `burn-down`; a Held one computes `animation: none`; an
  unconfirmed Append also holds; the footer offers Save now + Hold, Save now alone once held,
  and Append + Save as new Note on the append path.
- `scripts/shot-grid.mjs --wet` (new flag): the just-filed card's `set` ring and slot-in.

**Not verified end-to-end in a browser:** a real commit needs CouchDB and a live LLM, and
neither is available here (no Docker). The commit path is covered at Seam A and the view over
it is four lines. This is the trade the spec already makes — "the view has no seam,
deliberately".

**A pre-existing bug found, not fixed here.** `--shadow-card` wraps a *shadow list* in
`light-dark()`, which only takes `<color>` values, so it computes to an invalid value and
`box-shadow` falls back to `none`. Every `.card` and the `.note` panel have had no shadow at
all since that token was written. Out of scope for this ticket — fixing it changes how every
card looks — so the wet ring is written standalone rather than composed with it, and this is
reported instead.

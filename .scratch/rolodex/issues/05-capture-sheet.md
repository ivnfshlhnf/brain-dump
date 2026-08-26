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

**Status:** ready-for-agent

- [ ] Catching a thought opens a full-screen field with nothing else on screen
- [ ] After Organize, the whole Note is shown before it is committed — not a summary standing in for it
- [ ] The countdown is visible on the preview card's top edge
- [ ] Hold stops the countdown, and the countdown does not restart on its own
- [ ] After Hold, an explicit action files the Note
- [ ] **Context** can be added, and the Note is organized from the full Dump
- [ ] A suggested Append is the primary action, with starting a new Note available as the secondary
- [ ] An unconfirmed Append never files on its own
- [ ] Committing returns to the grid with the new card at the top
- [ ] Capturing with no connection saves the Dump and says it is waiting — never that it failed
- [ ] Leaving a capture uncommitted keeps the Dump and re-surfaces it on the next open
- [ ] The autosave module's interface is unchanged

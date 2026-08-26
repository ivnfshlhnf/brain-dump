# 10 — Promote the grid to home, delete the Field Notebook

**What to build:** The cutover. The grid stops being a fourth view and becomes the app's only
persistent surface; the three old views are deleted; Capture, Ask and Settings are reached only
as sheets. A slim masthead carries the wordmark and the settings gear.

This ticket is gated on the sheets because deleting the old views without them makes the app
unusable, and gated on 03 because deleting the old Settings removes the reconcile button — so
cutting over first would make a **Stranded** **Dump** *less* reachable than it is today, a
regression on the exact problem this redesign exists to fix.

04 is not a technical gate: the grid works colourless. But shipping the home surface without
**Category** colour leaves the direction half-landed, and it should land first.

**Blocked by:** 03, 05, 06, 07, 08, 09

**Status:** ready-for-agent

- [ ] The grid is the only persistent surface, and sheets do not nest
- [ ] The three old views are deleted and the Field Notebook implementation is gone from the app
- [ ] A masthead carries the wordmark and a settings gear
- [ ] Every sheet is reached from the grid and returns to it
- [ ] Keyboard shortcuts reach Ask and Settings
- [ ] A Stranded Dump is at least as reachable after the cutover as it was before
- [ ] Dark is the default when the system expresses no preference, and light follows the system
- [ ] The screenshot verification scripts cover the grid and all four sheets

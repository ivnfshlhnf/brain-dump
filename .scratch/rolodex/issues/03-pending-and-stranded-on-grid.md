# 03 — Pending and Stranded appear on the grid

**What to build:** The grid stops being a list of Notes and becomes a list of *thoughts*. A
**Pending** **Dump** gets a card. A **Stranded** Dump gets a card. Both pin to a band above the
Notes, so a thought the app owes the user something for is the most visible thing on screen
rather than the least.

The same **Vault** pass that fills the grid finds the Stranded Dumps, so reconciliation stops
being a button the user has no reason to press and becomes a property of opening the app. This
is the ticket that fixes the problem the whole redesign exists for: four thoughts were once
taken, never filed, and never mentioned again.

A **Dismissed** Dump gets no card at all — dismissing means "stop telling me about this".

**Blocked by:** 02

**Status:** done

- [x] Opening the app reconciles the Vault with no button pressed
- [x] One Vault pass yields both the Note projection and the Stranded list
- [x] A Pending Dump appears as a dashed, hue-less card
- [x] A Stranded Dump appears as a dashed card showing the user's raw words
- [x] A Stranded card offers a retry and a dismiss, actionable where the user found it
- [x] Pending and Stranded cards pin above the Notes and stay visible however many Notes exist
- [x] Dismissing removes the card, writes nothing to the Vault, and leaves the Dump exactly where it is
- [x] A Dump that is already Pending, or already Dismissed, is never reported as Stranded
- [x] A Dump whose Note was deleted by Obsidian's own sync surfaces as Stranded
- [x] Tests at the operation-layer seam assert the Stranded results match the existing reconciliation operation for the same Vault

### Close-out notes

- **Reconcile fires on grid open, not app mount.** The grid is not home until ticket 10, so
  "opening the app reconciles" is read as "opening the grid reconciles" — `enterGrid` calls
  `readGrid`, which does the one Vault pass. This is the agreed deviation from the literal
  wording of the first checkbox.
- **The Settings Reconcile button + Stranded list stay as a fallback.** The grid does not
  replace the Settings flow; `findStrandedDumps` is unchanged behaviour (refactored to share
  `deriveStranded`, same output, same log) and the Settings UI is untouched.
- **One pass:** `readVaultForGrid` / `readGrid` do a single `readVaultFiles` (managed + dumps,
  `includeDeleted`) and derive both the cards and the Stranded list from it (`buildVaultState`
  → `toCards` + `deriveStranded`). `findStrandedDumps` shares the same helpers.
- **Verified:** `npm run typecheck` 0 errors; `npm test` 180 passed / 9 skipped;
  `tests/pending.test.ts` 37 unchanged-green; `tests/cards.test.ts` rewritten for `readGrid`
  (11 tests incl. a deep-equality check that `readGrid`'s Stranded list matches
  `findStrandedDumps` for the same Vault). Visual verified by DOM measurement (dashed border,
  transparent fill, mono raw words vs serif Note titles, 3 bands, Retry + Dismiss) and by
  screenshot in light/dark × desktop/phone.

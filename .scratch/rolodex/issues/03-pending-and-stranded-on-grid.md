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

**Status:** ready-for-agent

- [ ] Opening the app reconciles the Vault with no button pressed
- [ ] One Vault pass yields both the Note projection and the Stranded list
- [ ] A Pending Dump appears as a dashed, hue-less card
- [ ] A Stranded Dump appears as a dashed card showing the user's raw words
- [ ] A Stranded card offers a retry and a dismiss, actionable where the user found it
- [ ] Pending and Stranded cards pin above the Notes and stay visible however many Notes exist
- [ ] Dismissing removes the card, writes nothing to the Vault, and leaves the Dump exactly where it is
- [ ] A Dump that is already Pending, or already Dismissed, is never reported as Stranded
- [ ] A Dump whose Note was deleted by Obsidian's own sync surfaces as Stranded
- [ ] Tests at the operation-layer seam assert the Stranded results match the existing reconciliation operation for the same Vault

# 01 — Domain terms and the ADRs

**What to build:** The written record the rest of this work is built on. The glossary gains the
terms the Rolodex depends on, and three ADRs record the decisions a future reader would
otherwise undo by accident. The Rolodex design files become the repo's design system; the
Field Notebook's is kept as a superseded record rather than deleted, because the Rolodex
inherits its reasoning.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] The glossary defines **Category** and **Tag**, and the definitions distinguish the one closed Category from the many open Tags
- [x] The glossary states that every **Dump** is in exactly one of four states — filed into a **Note**, **Pending**, **Stranded**, or **Dismissed**
- [x] The glossary states that only a Stranded Dump can be Dismissed, that a sheet the user shuts is *closed*, and that a message they wave away is *cleared*
- [x] An ADR records the change of direction to the Rolodex, and names the restraint that was traded away
- [x] An ADR records the home read, reconciliation-on-read, and the projection cache
- [x] ADR-0005 gains a pointer to that ADR, and its own decision — Pending state is device-local — is left unchanged
- [x] An ADR records Category as a closed vocabulary, with hue derived from a member's position in the declared list
- [x] The Rolodex design files sit at the repo root and replace the Field Notebook's (**product** file deliberately not moved — see Comments)
- [x] The Field Notebook's design record is kept and marked superseded

## Comments

**The Rolodex `PRODUCT.md` was deliberately not promoted.** The criterion said "design and
product files". On inspection the Rolodex's `PRODUCT.md` is the root one *plus* two
prototype-scoped sections, and every difference makes it worse at the repo root: it points at
`../brain-dump` paths that do not resolve from inside the repo, it cites the sibling brainstorm
directory for its mockups, and it replaces the real Evidence on Hand — a Vault in daily use, the
diagnostic event log, the dogfooding findings — with prototype evidence. It also still frames
the direction as "proposed / exploring", which is no longer true. Root `PRODUCT.md` is the
canonical product record and is unchanged. Only `DESIGN.md` and `.impeccable/design.json` moved.

**The promoted `DESIGN.md` needed reconciling before it could land.** It was written before the
Stranded work and before the colour decisions, and shipped three contradictions: `queued` and
`failed` as colour tokens (words `CONTEXT.md` rejects), a hand-cut eight-hue palette, and
`categoryHue()` as a string hash. Fifteen edits brought it in line with ADR-0008 — state tokens
renamed to **Pending** and **Stranded**, the palette replaced by the golden-angle derivation with
the five real Categories, and the append-only warning added. The status-line section was also
narrowed from four kinds to three, since **Pending** and **Stranded** now have their own cards.
`.impeccable/design.json` received the same corrections, including its demo swatches, which had
been showing the mockup's invented Categories (`recipes`, `family`, `house`, `writing`).

**ADR-0005's amendment is narrower than expected, and the design is stronger for it.**
ADR-0005 gave two reasons for manual reconciliation. The first — the cost of a full-Vault read —
is moot, because the grid now performs that read to paint. The second was that an automatic scan
"would spend LLM calls Organizing thoughts the user may have abandoned weeks ago", and that one
is *preserved*: finding a Stranded Dump is not Organizing it. Reconciliation only ever produced a
list, and Organize was always a separate action. ADR-0007 records this, and ADR-0005 was amended
in place rather than superseded, since its actual decision — Pending state is device-local — is
untouched.

**Verification:** full suite green — 169 passed, 9 skipped (the three gated smoke suites). No
source changed in this ticket.

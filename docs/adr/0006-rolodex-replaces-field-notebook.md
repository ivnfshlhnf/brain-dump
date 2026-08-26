# The Rolodex replaces the Field Notebook

The app's view becomes a self-sorting grid of cards with four full-screen sheets, replacing the
Field Notebook's one-entry-at-a-time notebook page. The product, the domain model and the
operation layer are unchanged. The Field Notebook's design record is kept as a superseded
document, because the Rolodex inherits most of its reasoning; its implementation is deleted.

## Context

The Field Notebook is a finished, defensible design and this is not a repair. Notes set in
serif on paper, two accents only, one entry at a time, state encoded in the accents — it holds
together, and nine Impeccable passes went into it.

Two things were nonetheless true of the app it produced.

It had **no surface that listed a Note**. There were three views — capture, ask, settings — and
none of them showed the user what they had written. The app could file a thought and answer a
question about it, but it could not show it.

And a **Stranded** **Dump** was reachable only by pressing a reconcile button in Settings that
the user had no reason to press. Four thoughts were taken, never filed, and never mentioned
again for exactly that reason (`.scratch/dogfooding/findings.md`, finding 02). The Vault kept
them; the app went quiet.

Underneath both is a mismatch with the one person who uses this. A notebook is a shape that
rewards lingering. This user is in and out in seconds — they want to glance, recognize, and
leave.

## Considered options

- **Keep the Field Notebook and add a browse view.** The smallest change, and it would close
  the "nowhere to see the Notes" gap. Rejected because it leaves the harder problem alone: a
  browse view bolted onto a book still buries a Stranded Dump, and the notebook's one-thing-at-a-
  time shape is what makes a list of thoughts awkward in the first place.

- **Ship both directions behind a theme toggle.** Tempting, since the Field Notebook works.
  Rejected: it doubles every future design decision for a one-person app, and the two are
  opposite bets about the same user rather than variations on one bet. Shipping both sides of a
  settled bet is a way of not settling it.

- **Replace the view with the Rolodex** (chosen). The grid makes every thought the app owes the
  user something for visible without opening anything, which is what turns finding 02 from a
  bug that was fixed into a class of bug that is hard to have.

## Consequences

- **The two-accent discipline is spent.** Colour now carries **Category** (ADR-0008). That is a
  real loss of restraint, taken deliberately for scanability, and it is the first thing to
  reconsider if the grid ever starts to look busy.
- **Most of the Field Notebook survives.** The two type faces (serif for the user's thought,
  mono for the app's scaffolding), the rule that a state always rides a word and never colour
  alone, and the wet-to-dry countdown all carry over. This is why its design record is kept
  rather than deleted — the Rolodex cites it.
- **Deleting the Field Notebook removes the Settings reconcile button.** So
  reconciliation-on-read (ADR-0007) must land before the cutover, or a Stranded Dump becomes
  *less* reachable than it was before the redesign — a regression on the problem the redesign
  exists to fix.
- **The `prototype/rolodex` branch is a primary source and is never merged.** Its
  `prototype.html`, its mockups and its Impeccable critiques record how this direction was
  found. Its `spec.md`, `DESIGN.md` and `PRODUCT.md` predate the Stranded work and use words
  `CONTEXT.md` rejects; the buildable spec at `.scratch/rolodex/spec.md` supersedes them.

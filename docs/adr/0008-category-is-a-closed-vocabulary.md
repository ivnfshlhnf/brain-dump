# Category is a closed vocabulary, and hue comes from a member's position

**Category** stops being free text and becomes a fixed set: `troubleshooting`, `productivity`,
`tools`, `coffee`, `personal`, and `uncategorized`. **Organize** is offered the members and must
choose one; anything else — including a blank — becomes `uncategorized`, which is an ordinary
member and not a failure. Each member's hue is derived from its **position in the declared
list**, never from the Category string.

## Context

The Rolodex spends its colour on Category (ADR-0006). That requires Category to be stable, and
it was not: the Organize prompt asked for "one category (string)" and whatever came back was
written to frontmatter.

The Vault was read once during design, and the result decided this. It held **12 Notes carrying
11 distinct Categories**: `Troubleshooting` (2), `beverage`, `Bug Report`, `Coffee`, `design`,
`Hardware`, `learning`, `Personal`, `Productivity`, `technical-issue`, `Tools`. Casing was
inconsistent across them.

At roughly one Category per Note, no colour scheme could work. A hue per Category would have
been very nearly a hue per card — colour that looks meaningful and conveys nothing. Closing the
vocabulary is not tidiness here; it is the precondition for colour meaning anything at all.

The duplication was also **semantic rather than orthographic**: `Troubleshooting`, `Bug Report`
and `technical-issue` are one Category spelled three unrelated ways, as are `Coffee` and
`beverage`. No normalization heuristic would have collapsed those, which is why the set had to
be chosen by a person rather than derived. The five members are that clustering:
`troubleshooting` (4 Notes), `productivity` (3, absorbing `design` and `learning`), `tools` (2),
`coffee` (2), `personal` (1).

## Considered options

- **Free-form, hashed into a fixed palette** — the prototype's approach. Rejected: the hue is
  derived from the string, so `recipe` and `recipes` are different colours, and unrelated
  Categories collide into one hue at random with no recourse. It is the drift the colour system
  exists to prevent, implemented.

- **Derive the set at runtime from the Categories already in the Vault.** Rejected three ways.
  It is *circular* — those Categories were written by the model under the free-form prompt, so
  the "closed" set would be the free-form system with an extra step. It is *unstable* — the set
  shifts as Notes accumulate, so a Category can drop out and every Note carrying it silently
  turns `uncategorized`, moving colours under the user. And it is a *seam violation* — the LLM
  seam has no Vault access, and would have to grow one to colour a chip.

- **A user-editable list in settings.** Defensible in principle: defining a vocabulary once is
  not filing, it is the same class of act as setting the Vault path. Rejected for now because
  settings are device-local IndexedDB, so the phone and the laptop would disagree about the
  vocabulary — a Note organized on one device would be coloured and `uncategorized` on the
  other. Kept reachable: because hue is keyed on position rather than on the string, promoting
  the list to synced data later is a data move and not a re-colouring of the Vault.

- **A closed union in source** (chosen). Parsing becomes total and the palette becomes bindable.

## Consequences

- **The list is append-only, and its order is load-bearing.** Appending a member is free.
  Inserting one, or sorting the list alphabetically, re-colours every Note in the Vault and
  raises no error. This has to be a comment on the type, not only a line in this ADR, because
  the person who breaks it will be reading the type.
- **Hue is stepped by the golden angle**, `hue = (index * 137.5 + 30) mod 360`, at a fixed
  lightness and chroma per scheme. This gives well-separated hues for any number of members, so
  there is no hand-cut palette to maintain and no ceiling on how many Categories may exist.
  `uncategorized` receives no hue and uses the neutral treatment **Tags** use — the absence of a
  Category is not a colour.
- **Adding a Category is a code change.** Noticing on a phone that a new one is needed means it
  waits for a laptop. That is the real ergonomic cost of choosing source over settings, and it
  is the thing that would push this to a synced list later.
- **`uncategorized` accumulating is the signal.** A growing cluster of colourless cards on the
  grid is the next Category, already sorted — the same evidence the original five came from.
- **Notes already in the Vault are not rewritten.** They keep frontmatter such as `Bug Report`
  and `Hardware`, read as `uncategorized`, and are corrected only when the user re-organizes
  that Note. A bulk rewrite across the Managed folder was rejected: it is a large write against
  the user's real files for a cosmetic gain, and the positioning of this product rests on those
  being the user's real files.
- **If Category colours become user-chosen later, they become data that must sync**, for the
  same reason the vocabulary itself could not live in settings. The derived hue is the default
  that a stored override would replace, keyed by Category name.

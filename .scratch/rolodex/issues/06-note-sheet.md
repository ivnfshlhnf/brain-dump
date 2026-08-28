# 06 — The Note sheet

**What to build:** Tapping a card opens the full **Note** as a full-screen sheet — the dry twin
of the pre-commit preview, at full length. For a forgetful user the thing they come back to
read is the organized entry; the raw words are provenance, kept and reachable but not the
headline.

The card was a door, so nothing the card truncated may stay truncated here.

**Blocked by:** 02

**Status:** done

- [x] Tapping a card opens the full Note
- [x] All **Tags** are shown, wrapping, with no truncation
- [x] A card's `+N more` opens the Note showing every Tag
- [x] The summary, key points and full body are shown
- [x] **Related** documents in the **Vault** are listed with links, so a connection can be followed
- [x] The verbatim **Dump** is available as the user's original words
- [x] The Note shows that it was filed and where in the Vault it went
- [x] Re-organizing refreshes the title, Tags, summary and **Category** against the current body
- [x] A link opens the Note in Obsidian, where editing actually happens
- [x] The sheet is reached from the grid and returns to it

## Comments

**Built.** The Note sheet is the same native modal `<dialog>` the Capture sheet is, opened the
same way (`showModal()`), so the platform supplies the top layer, the focus trap and the one
`close` event that is the only way out. The card was a door, so the room behind it drops every
truncation the card made: every Tag wraps (the card showed three and a count), the body, the key
points and the Related links are shown in full, and the verbatim source Dump is kept as
provenance behind the organized thought — the one thing the card never held.

**The eyebrow is the filing stamp and the door back into the Vault.** "Filed" plus the Note's
path, as an `obsidian://open` link, so opening the Note where editing actually happens is one tap.
Related links are the same `obsidian://` form, resolved through `linkHref`/`linkText` so a
wikilink, an external URL and a `[[path|alias]]` each read honestly.

**Re-organize finally has a surface.** Ticket 05 left `refreshNoteMetadata` with nowhere to live;
it lives here. A review found it was organizing against the trailing `## Summary` / `## Key
points` / `## Related` sections the file itself appends, not "the current body" the criterion
names — so the re-derived metadata was coloured by its own stale sections. Fixed: the organizer
now receives the cleaned body (`splitNoteBody` strips the sections) while the write-back still
preserves the body verbatim. Pinned by a Seam A test that records the body the organizer was
handed and asserts none of the section headings reached it.

### Verification

- Seam A, `tests/note-sheet.test.ts` (new): `parseNote` round-trips `noteFileContent` field for
  field and preserves a body that itself uses `##` headings; `readNote` returns the full Note a
  card points at with every Tag (a tag-heavy Note's 10 tags all survive), the verbatim source
  Dump (content + context), a null Dump when the source is gone, and null for a missing path;
  `reorganizeNote` re-derives title/Tags/summary/Category, preserves the body byte-for-byte,
  assigns a member Category to a legacy Note, and hands the organizer the cleaned body — never
  the stale trailing sections.
- `scripts/shot-note.mjs` (new): the sheet in three states × 2 widths × 2 schemes. The card is
  a real, clickable one (seeded into the device-local card cache, with CouchDB pointed at a dead
  port so the Vault read rejects and the cached card is kept) — the sheet's `showModal()` flow is
  the app's own, not a mock's. The note content is injected into the real, open sheet body the
  way `shot-capture.mjs` injects the review state. Measured: the sheet is `:modal`, covers the
  viewport, the path is an `obsidian://open` link, the tag-heavy state shows all 10 tags (no
  `+N more`), the verbatim Dump is present, and the foot offers Re-organize only when a Note is
  on screen (the gone state has none).

**Not verified end-to-end in a browser:** a real readNote needs CouchDB, which is not available
here (no Docker). The read/parse/reorganize paths are covered at Seam A; the view over them is
the sheet's chrome plus the injected-content screenshots. This is the trade the spec already
makes — "the view has no seam, deliberately".

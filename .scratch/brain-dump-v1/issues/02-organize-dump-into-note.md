# 02 — Organize a Dump into a Note

**What to build:** As the user, I capture a thought and the app **Organizes** it via the cloud LLM into a **Note** written to the managed folder, with the v1 schema and a link back to the source Dump.

**Blocked by:** 01 — Capture a text brain-dump as a raw Dump in the vault.

**Status:** done

- [x] After a Dump is saved, the app runs an initial Organize via the cloud LLM and writes a Note to the managed folder (`Brain Dump/`). *(Orchestration via `organizeDump` + `createOrganizer`; the live cloud-LLM HTTP call is best-effort plumbing validated by Seam A tests with a deterministic fake — same caveat class as ticket 01's real-CouchDB item.)*
- [x] The Note frontmatter follows the v1 schema (type shape from the design session): `title, tags, created, modality, source, category, summary`; the body is the cleaned content with `## Summary`, `## Key points`, `## Related` sections.
- [x] `source` is an Obsidian wikilink to the source Dump.
- [x] The Note filename is `<YYYY-MM-DD>-<title-slug>.md`.
- [x] The Note is written to CouchDB in valid LiveSync document format (same conventions as the Dump).
- [x] Config gains LLM provider, model, and API key fields, persisted in IndexedDB.
- [x] Tests stub the LLM with a deterministic Organize response and assert the resulting Note doc (schema, filename, source link) without a real LLM call.

## Notes

- The operation layer keeps `capture` and `organizeDump` as separate seams. The full `capture(text)` composition (Dump + initial Organize + Note preview + new-vs-append match) defined at spec line 60 spans tickets 02+03+04; ticket 03 ("capture review flow") composes the capture→preview flow. Ticket 02 delivers the Organize operation seam itself.
- `sourceWikilink` re-derives the Dump filename via the shared `dumpFilename` helper (the same one `capture` uses), so the two cannot drift independently; the spec's `Dump` type carries no `path` field to thread instead.
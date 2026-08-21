# 02 — Organize a Dump into a Note

**What to build:** As the user, I capture a thought and the app **Organizes** it via the cloud LLM into a **Note** written to the managed folder, with the v1 schema and a link back to the source Dump.

**Blocked by:** 01 — Capture a text brain-dump as a raw Dump in the vault.

**Status:** ready-for-agent

- [ ] After a Dump is saved, the app runs an initial Organize via the cloud LLM and writes a Note to the managed folder (`Brain Dump/`).
- [ ] The Note frontmatter follows the v1 schema (type shape from the design session): `title, tags, created, modality, source, category, summary`; the body is the cleaned content with `## Summary`, `## Key points`, `## Related` sections.
- [ ] `source` is an Obsidian wikilink to the source Dump.
- [ ] The Note filename is `<YYYY-MM-DD>-<title-slug>.md`.
- [ ] The Note is written to CouchDB in valid LiveSync document format (same conventions as the Dump).
- [ ] Config gains LLM provider, model, and API key fields, persisted in IndexedDB.
- [ ] Tests stub the LLM with a deterministic Organize response and assert the resulting Note doc (schema, filename, source link) without a real LLM call.
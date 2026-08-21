# 01 — Capture a text brain-dump as a raw Dump in the vault

**What to build:** As the user, I type a thought and it is saved immediately as a verbatim **Dump** in the `_dumps/` folder of my Obsidian vault, written to the LiveSync CouchDB backend in its internal document format. This slice proves the riskiest integration (ADR-0001) end-to-end and establishes the scaffolding everything else uses: the PWA shell, the config UI (CouchDB URL/database/username/password, managed folder name, case-sensitivity toggle), the IndexedDB settings store, the operation layer, and the test harness (in-memory PouchDB stand-in for CouchDB, deterministic LLM fake).

**Blocked by:** None — can start immediately.

**Status:** done

- [x] Typing text and submitting creates a Dump containing the verbatim text, saved immediately (before any Organize).
- [x] The Dump is written to CouchDB in valid LiveSync document format: a metadata doc plus a single content-addressed chunk doc, with `_id` the lowercased vault-relative path (original case in `path`), and the `/_dumps/` prefix for the underscore-leading folder.
- [ ] The Dump appears in the `_dumps/` folder in Obsidian via LiveSync sync. *(Requires a real CouchDB/LiveSync backend; format validated by Seam A tests and ADR-0001 compliance.)*
- [x] The config UI captures CouchDB URL, database name, username, password, the managed folder name, and a case-sensitivity toggle; settings persist in IndexedDB across sessions.
- [x] The app runs as a PWA in a browser.
- [x] Tests drive `capture(text)` through the operation layer with a PouchDB stand-in and a deterministic LLM fake, asserting the written LiveSync-format docs and the Dump's verbatim content, with no network or real LLM calls.
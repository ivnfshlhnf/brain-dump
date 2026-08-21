# 06 — Retrieve: RAG Q&A over the whole vault

**What to build:** As the user, I type a question and get a synthesized answer with citations to the source Notes, drawn from my entire vault (including personal notes).

**Blocked by:** 02 — Organize a Dump into a Note.

**Status:** ready-for-agent

- [ ] A typed question fetches all Notes from CouchDB (the whole vault, including personal notes), re-embeds them, and runs RAG via the cloud LLM.
- [ ] The result is an answer string plus cited Note links.
- [ ] The app reads the whole vault but writes nothing outside its managed folders (ADR-0002).
- [ ] Config gains an embedder model field, persisted in IndexedDB.
- [ ] v1 uses re-embed-on-query (no persistent vector index).
- [ ] Tests stub the LLM/embedder with deterministic responses and assert the answer + citations and that only reads occur, with no real LLM/network calls.
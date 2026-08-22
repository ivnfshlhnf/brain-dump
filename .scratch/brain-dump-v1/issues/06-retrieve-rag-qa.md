# 06 — Retrieve: RAG Q&A over the whole vault

**What to build:** As the user, I type a question and get a synthesized answer with citations to the source Notes, drawn from my entire vault (including personal notes).

**Blocked by:** 02 — Organize a Dump into a Note.

**Status:** done

- [x] A typed question fetches all Notes from CouchDB (the whole vault, including personal notes), re-embeds them, and runs RAG via the cloud LLM. *(`retrieve` in `retrieve.ts`: `readVaultFiles` (in `livesync.ts`) reads every file, reassembling the several chunks LiveSync writes for a larger personal note; the whole vault plus the question is embedded via the `Embedder` seam, ranked by cosine similarity, and the top `RETRIEVE_TOP_K` go to the `Answerer` seam.)*
- [x] The result is an answer string plus cited Note links. *(`RetrieveResult` — the answer plus `Citation`s carrying an Obsidian wikilink. The model names the sources it drew on by index; invented indexes are dropped, and naming nothing cites nothing, so "I couldn't find that" arrives without citations stapled to it.)*
- [x] The app reads the whole vault but writes nothing outside its managed folders (ADR-0002). *(Retrieve only reads; the test passes a `DocStore` whose `put` throws — `put` being the interface's only write — so any write fails the test.)*
- [x] Config gains an embedder model field, persisted in IndexedDB. *(An "Embedder model" input in the config view; `tests/settings.test.ts` round-trips it through IndexedDB via `fake-indexeddb`.)*
- [x] v1 uses re-embed-on-query (no persistent vector index). *(No index is stored; a test asserts the vault text is re-embedded on a second Retrieve.)*
- [x] Tests stub the LLM/embedder with deterministic responses and assert the answer + citations and that only reads occur, with no real LLM/network calls. *(`tests/retrieve.test.ts`, 12 tests: answer + citations, personal notes included and citable by filename, no writes, multi-chunk reassembly, raw Dumps excluded, re-embed per Retrieve, top-K ranking, invented indexes dropped, empty choice cites nothing, empty vault answers without calling the model, no embedding for the question fails loudly, and empty question rejected.)*

## Comments

- Raw Dumps are left out of the retrieval sources — a Dump's content is already represented by its Note, so including both would double-count every brain-dump. Recorded as a consequence in ADR-0002: a Dump whose Note has not been written yet (a failed final save, or one still queued offline) is not retrievable until it is Organized.
- Reviewed on the Standards and Spec axes; fixes applied for glossary drift (`VaultNote` → `VaultDoc`, since Retrieve reads personal notes too, and "query" in a test name), helpers exported past the operation surface, a dead default parameter, split ownership of citation validation, a duplicated wikilink construction, the empty-`sources` citation bug, and an unguarded empty embedding for the question.
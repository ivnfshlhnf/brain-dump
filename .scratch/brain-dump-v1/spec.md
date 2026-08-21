Status: ready-for-agent

# Brain-dump v1 (text-only)

## Problem Statement

Fleeting thoughts are easy to have and hard to capture. By the time I can open a note, switch to the right folder, and title it, the thought is gone — or arrives as a voice memo I never transcribe or revisit. Even when I do capture thoughts, they pile up unorganized, and months later I can't find "that thing I was thinking about X." Existing tools either force me to organize upfront (killing the spontaneity) or store my dumps somewhere disconnected from the knowledge base I actually use. I want to dump a thought the moment it strikes, have it organized for me without losing the original, land it in my Obsidian vault, and later get a real answer — not a file list — when I ask what I thought about a topic.

## Solution

A single-user PWA for capturing a thought as text (voice deferred to iteration 2), auto-organizing it into a retrievable Note, and answering natural-language questions over the accumulated vault. On capture, the app writes a raw, immutable **Dump** to the vault and runs an initial **Organize** to show the user a preview of the organized **Note**. The user may add **Context** (which edits the Dump while preserving the verbatim original), and the Note is finalized and saved on a 5-second inactivity auto-save (or on close). Notes and Dumps are written directly to the Obsidian LiveSync CouchDB backend in its internal document format, so they sync to every device through LiveSync. **Retrieve** takes a natural-language question, reads the whole vault, and returns a synthesized answer with citations back to the source Notes. A config UI lets the user point the app at their CouchDB and cloud LLM.

## User Stories

1. As the user, I want to capture a thought by typing text, so that I can record it before I lose it.
2. As the user, I want the app to save my raw text immediately on capture, so that the thought is never lost even if I close before organizing finishes.
3. As the user, I want the app to automatically organize my dump into a titled, tagged, summarized Note, so that I don't have to structure my thoughts myself.
4. As the user, I want to see a preview of the organized Note right after I capture, so that I can tell whether the app understood me.
5. As the user, I want to add extra context to the dump before it's saved, so that I can refine the thought while it's fresh.
6. As the user, I want my verbatim original capture preserved inside the dump even after I add context, so that I never lose what I actually said.
7. As the user, I want the Note to be saved automatically after I stop typing for a few seconds, so that I don't have to remember to hit save.
8. As the user, I want the Note to be saved if I close the app before the auto-save fires, so that my organized Note isn't lost.
9. As the user, I want the final Note to be re-organized from the full dump (original plus my added context) at save time, so that the title, tags, and summary reflect everything I added.
10. As the user, I want the dump to become immutable once its Note is saved, so that the raw record of what I captured is a stable archive.
11. As the user, I want the app to suggest an existing Note to append to when my new dump is related, so that related thoughts accumulate in one place.
12. As the user, I want to confirm "new Note vs append to [suggested Note]" with one action, so that capture stays frictionless.
13. As the user, when a dump appends to an existing Note, I want it added as a new dated section, so that the history of additions is preserved.
14. As the user, when a dump appends to an existing Note, I want my hand-edits to the Note body preserved, so that the app never silently overwrites my work.
15. As the user, I want metadata refresh (re-deriving title/tags/summary) to be something I trigger explicitly, so that the app never auto-overwrites tags I curated.
16. As the user, I want my Notes and Dumps to live in my Obsidian vault, so that I can browse, edit, and link them in the tool I already use.
17. As the user, I want the app's Notes to live in a dedicated managed folder, so that the app's output is separate from my personal notes.
18. As the user, I want my personal notes left untouched by the app, so that the app never writes to or corrupts my own content.
19. As the user, I want my raw Dumps stored in an out-of-the-way folder, so that they don't clutter my vault browsing.
20. As the user, I want each Note's filename to start with its date, so that Notes sort chronologically in Obsidian.
21. As the user, I want each Note to link back to its source Dump, so that I can jump from a Note to the raw original.
22. As the user, I want to ask a question in natural language and get a real answer, so that I don't have to grep my own vault.
23. As the user, I want the answer to cite the source Notes it drew from, so that I can verify and open the originals.
24. As the user, I want retrieval to draw on my entire vault (including my personal notes), so that answers reflect everything I know, not just brain-dumps.
25. As the user, I want to capture a thought even when I'm offline, so that a dead signal doesn't cost me the thought.
26. As the user, I want offline captures to sync and organize automatically once I'm back online, so that offline dumps still become Notes without my intervention.
27. As the user, I want to configure the CouchDB connection (URL, database name, username, password) once, so that the app knows where my vault lives.
28. As the user, I want to configure the cloud LLM (provider, model, API key) once, so that Organize and Retrieve work.
29. As the user, I want to configure the embedder model, so that retrieval uses the embeddings I want.
30. As the user, I want my configuration persisted between sessions, so that I don't re-enter it every time I open the app.
31. As the user, I want the app to be a single-user personal app, so that my brain-dumps stay private to me.
32. As the user, I want the organized Note to contain a cleaned body plus summary, key points, and related links, so that it's genuinely useful to revisit.
33. As the user, I want the Note to carry tags and a category, so that I can browse and filter in Obsidian.
34. As the user, I want the Note to record whether it came from a voice or text capture, so that I can tell the origin of each Note (modality).
35. As the user, I want the app to handle the case where I edit a Note in Obsidian at the same time the app appends to it, so that my edits and the app's addition both survive.
36. As the user, I want the app to retry an append when it hits a save conflict, so that a concurrent edit doesn't silently drop my new dump.
37. As the user, I want the app to run as a PWA in my browser, so that I can capture from any device without installing an app.
38. As the user, I want the config UI to let me set the managed folder name, so that the app fits my existing vault layout.
39. As the user, I want the config UI to let me set the case-sensitivity to match my LiveSync, so that the app writes doc IDs the way LiveSync expects.
40. As the user, I want retrieval to give me a text answer, so that I can read it on screen (no spoken answer needed in v1).

## Implementation Decisions

- **Capture surface**: a PWA (browser mic not used in v1; text input only). The UI is a thin shell over the app's operation layer; the operation layer is the unit the UI calls and the unit under test.
- **Operation layer (public interface)**:
  - `capture(text)` → creates a **Dump** (saved immediately), runs an initial **Organize**, returns a **Note preview** plus a match decision (new Note vs append to an existing Note). Accepts added **Context** (edits the Dump, preserves the verbatim original) and finalizes on auto-save.
  - `retrieve(question)` → fetches vault Notes, re-embeds, runs RAG, returns an answer string plus cited Note links.
- **Storage — LiveSync CouchDB direct (ADR-0001)**: the app writes directly to the Obsidian LiveSync CouchDB backend over HTTP, in LiveSync's internal document format. Each file is a metadata doc plus content-addressed chunk doc(s); the app writes each file as a single chunk for simplicity. Doc `_id` is the lowercased vault-relative path (original case preserved in `path`); underscore-leading folders (e.g. `_dumps/`) get a leading `/` prefix. Chunk `_id` is `h:` + the hash of the content, using the hash algorithm configured in the user's LiveSync. The vault must be unencrypted (E2EE off), and path obfuscation off (obfuscation is gated behind E2EE, so it is off by consequence).
- **Scope (ADR-0002)**: the app writes only to the managed Notes folder (`Brain Dump/`) and the Dumps folder (`_dumps/`). Retrieve reads the entire vault, including the user's personal notes, but the app never writes outside its two managed folders.
- **Dump lifecycle**: a Dump is editable during the capture session (the user adds Context, which appends to the Dump while the verbatim original is preserved inside it). Once the Note is saved (auto-save or close-save) the session ends and the Dump is frozen and immutable thereafter.
- **Capture flow**: capture → Dump saved immediately → initial Organize → Note preview shown (alongside the new-vs-append match) on one screen → user may add Context (preview holds the initial Organize) → 5s inactivity auto-save (or `beforeunload` on close) → final Organize over the full Dump → Note written, Dump frozen. If the final save fails, the Dump persists and the Note is generated from it later.
- **Append**: when a Dump matches an existing Note, the match is offered with a one-tap confirm. Appending adds a new dated section to the Note body; it never overwrites user edits. Metadata refresh is explicit (user-triggered), never automatic.
- **Conflict policy**: app writes are append-only to the body; the app uses optimistic concurrency (write with the current CouchDB `_rev`; on 409, re-fetch, re-apply the append, retry). Frontmatter is written once at Note creation; later metadata refresh is explicit.
- **Offline**: an outbox in IndexedDB queues Dumps captured with no connection. On reconnect, queued Dumps sync to CouchDB and are Organized into Notes. Organize/preview is an online-time step — offline captures show "saved, will organize when online" and produce no preview until reconnected.
- **LLM/embeddings (cloud)**: a cloud provider (Ollama Cloud) provides Organize, embeddings, and Retrieve synthesis. v1 uses re-embed-on-query: each Retrieve fetches all vault Notes fresh from CouchDB and embeds them (no persistent vector index). Organize and Retrieve use the same provider.
- **Organize timing**: the initial Organize runs at capture to produce the preview; the final Organize runs once at save over the full Dump (original + Context). There is no live re-organize on each keystroke.
- **Config UI**: a settings screen captures CouchDB (URL, database name, username, password), the cloud LLM (provider, model, API key), the embedder model, the managed folder name, and a case-sensitivity toggle to match the user's LiveSync. Configuration is stored in IndexedDB (plaintext — acceptable for a single-user personal app on a device the user controls; not XSS-hardened).
- **Note schema (type shape, from the design session)** — the Note's Obsidian frontmatter:
  ```
  title, tags, created, modality, source, category, summary
  ```
  The Note body is the cleaned/organized content; sections `## Summary`, `## Key points`, `## Related`. `source` is an Obsidian wikilink to the source Dump. A Dump holds the verbatim original (e.g. a `## Original` section) plus any added Context, with minimal frontmatter.
- **Filenames**: Notes `<YYYY-MM-DD>-<title-slug>.md` in the managed folder; Dumps `<YYYYMMDD-HHMMSS>-<shortid>.md` in `_dumps/`.
- **Modality**: v1 captures and queries are text only. The `modality` field is recorded as `text`; voice values are reserved for iteration 2.

## Testing Decisions

- **What makes a good test**: assert only on external behavior through the operation layer (`capture`, `retrieve`, offline/reconnect, config) — never on internal module implementation details. The cloud LLM/embedder is stubbed with deterministic fakes (canned Organize, embedding, and Retrieve responses) so tests assert the app's orchestration, not model output. CouchDB is represented by an in-memory PouchDB (CouchDB-compatible) stand-in so tests assert on real stored docs without a network dependency. No test hits the network or a real LLM.
- **Seam A — Application operations (primary seam)**: drive `capture(text)` and `retrieve(question)` plus offline/reconnect and config as black boxes, asserting observable outcomes:
  - A Capture writes a valid LiveSync metadata doc + chunk doc for the Dump in `_dumps/` and the Note in the managed folder — correct `_id` (lowercased path, `/_dumps/` prefix), original-case `path`, the v1 frontmatter schema, the verbatim original preserved inside the Dump, the Note frozen after save, and the agreed filenames.
  - Append: a Capture matched to an existing Note adds a dated section without overwriting user edits; metadata refresh stays explicit.
  - Offline: a Capture with no connection queues the Dump in the outbox and produces no Note until reconnect; on reconnect the Note is produced.
  - Retrieve returns an answer string plus cited Note links drawn from the whole vault.
  - Context-add/autosave: adding Context edits the Dump (original preserved), the preview holds the initial Organize, and the final Note is re-organized at the 5s autosave.
- **Seam B — LiveSync doc-format smoke test (optional, risk-driven)**: a small integration test against a real CouchDB asserting the app's written docs are accepted by LiveSync's reader. Validates only the doc-format contract (the biggest external risk per ADR-0001), not app logic.
- **Prior art**: none — this is a greenfield repo with no existing tests. Seam A establishes the testing pattern for the codebase.
- **Modules under test**: the operation layer (capture, organize orchestration, append/match, outbox, retrieve, config). Internal helpers are exercised only through these operations.

## Out of Scope

- **Voice capture and voice questions** (STT via Whisper API, browser mic) — deferred to iteration 2.
- **TTS / spoken answers** — dropped; v1 answers are text only.
- **Persistent vector index** — v1 uses re-embed-on-query; a persistent `_changes`-fed index is a later optimization when query latency demands it.
- **End-to-end encryption** and path obfuscation on the synced vault — incompatible with external CouchDB writes (ADR-0001); the vault must be unencrypted.
- **Multi-user / shared vaults** — single-user personal app only.
- **Writing to the user's personal notes** — the app reads the whole vault for Retrieve but writes only `Brain Dump/` and `_dumps/`.
- **Live re-organize on each keystroke** — Organize runs at capture and once at save, not per edit.
- **A companion daemon / local-filesystem writes** — rejected for simplicity (ADR-0001); the PWA writes to CouchDB directly.
- **A native mobile app** — the PWA covers cross-device capture in v1.
- **Credential encryption at rest** — v1 stores config in IndexedDB plaintext (XSS caveat accepted for a single-user personal app).

## Further Notes

- **Build-time facts to confirm before/during implementation** (not design decisions): the LiveSync chunk hash algorithm (xxHash vs SHA-1) — the app's chunk `_id` must match it; the CouchDB URL and credentials; the exact cloud LLM and embedder model IDs; confirmation that "Handle files as Case-Sensitive" is off in the user's LiveSync (default is case-insensitive); the exact format of the preserved original inside the Dump (`## Original` section recommended).
- **ADR-0001 coupling risk**: the app depends on LiveSync's internal document format, for which there is no official external-write API yet (GitHub issue #795 is the maintainer's acknowledgment, docs unpublished). A LiveSync format change could break the app; Seam B mitigates this by pinning the format contract.
- **Privacy note (ADR-0002 consequence)**: because Retrieve reads the whole vault and uses a cloud LLM/embedder, the user's personal notes are sent to the cloud provider during retrieval, not just brain-dumps. This is consistent with the cloud-LLM decision and is accepted for v1.
- **Domain vocabulary**: this spec uses the terms defined in `CONTEXT.md` (Brain-dump, Dump, Context, Note, Organize, Append, Retrieve, Modality). Implementation should use the same vocabulary in code and tests and not drift to avoided synonyms.
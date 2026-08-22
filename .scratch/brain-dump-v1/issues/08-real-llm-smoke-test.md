Status: done

# 08 — Real cloud LLM/embedder smoke test (Seam C)

**Blocked by:** 02 — Organize a Dump into a Note, 06 — Retrieve: RAG Q&A over the whole vault, 07 — LiveSync doc-format smoke test (for the env-gating + throwaway-CouchDB pattern).

## Problem Statement

The app runs end-to-end and the UI is wired to real seams, but the operation layer is only tested with **deterministic fakes** (Seam A) and the LiveSync doc-format is pinned against a **real CouchDB** (Seam B). The real cloud LLM/embedder seam — the actual Organizer, Embedder, and Answerer talking to a live Ollama-compatible endpoint — has never been exercised. It is explicitly "best-effort plumbing, not unit-tested." This is the single highest-risk, untested path in the app: a user pointing it at their real CouchDB and a real Ollama-compatible model could hit failures in prompt formatting, strict-JSON parsing, embedding dimension/shape, or the full Retrieve loop, and no existing test would have caught any of it. Before dogfooding, we need confidence the app genuinely works end-to-end against a real provider — not just that its orchestration is correct against fakes.

## Solution

A real-cloud integration smoke test (Seam C) that drives the **existing operation-layer seam** (`organizeDump`, `retrieve`) as black boxes, but swaps the fake cloud deps for the **real** `createOrganizer` / `createEmbedder` / `createAnswerer` against a live Ollama-compatible endpoint, and the in-memory DB for a **real CouchDB** (reusing Seam B's `docker-compose.smoke.yml`). It asserts the real seams return well-typed, non-empty output, and that the full loop runs: Organize a Dump → the Note is written to the real CouchDB → Retrieve a question over the vault → a synthesized answer with citations. The test is opt-in and env-gated so the default `npm test` never needs a live LLM or CouchDB; credentials are read from environment variables at run time, so API keys never enter the repo. Test-only — no app behavior changes.

## User Stories

1. As the maintainer, I want a test that exercises the real cloud Organizer against a live Ollama-compatible endpoint, so that I know the Organize plumbing (prompt building, strict-JSON request, response parsing onto `OrganizeOutput`) actually works.
2. As the maintainer, I want a test that exercises the real cloud Embedder, so that I know the embedding call returns numeric vectors of a consistent dimension that Retrieve can rank.
3. As the maintainer, I want a test that exercises the real cloud Answerer, so that I know the RAG generation call returns an answer string plus source indexes that map to real citations.
4. As the maintainer, I want the full Retrieve loop run against a real CouchDB with a real LLM, so that I know a Note written by the app is actually read back, embedded, ranked, and cited — the integration no fake can cover.
5. As the maintainer, I want the test skipped by default, so that `npm test` stays green without a live LLM or CouchDB in CI or a fresh checkout.
6. As the maintainer, I want the test opted into with a single env var, so that running it is a deliberate, documented action rather than a surprise network call.
7. As the maintainer, I want all cloud and CouchDB credentials read from environment variables, so that API keys and passwords never get committed to the repo or pasted into shared context.
8. As the maintainer, I want the test to use a throwaway CouchDB (create then destroy), so that a run leaves no persistent state and can be repeated cleanly.
9. As the maintainer, I want the test to assert structure, types, and non-emptiness — not exact strings — so that it is stable across the non-deterministic output of a real model.
10. As the maintainer, I want the test to assert the Organizer returns a non-empty title, tags, category, summary, key points, and body, so that a model returning an empty or malformed field fails the test. (`related` is asserted for shape only — it is the one Organize output with a legitimate empty value; see the Comments.)
11. As the maintainer, I want the test to assert the Embedder returns equal-length numeric vectors for every document and the question, so that a dimension mismatch (which would break cosine similarity) is caught.
12. As the maintainer, I want the test to assert the Answerer returns a non-empty answer string and a `sources` array of valid indexes, so that a model that invents indexes or returns nothing is caught.
13. As the maintainer, I want the test to assert the Retrieve result carries citations whose paths correspond to Notes actually written to the vault, so that a dead-link citation is caught.
14. As the maintainer, I want the test to assert the Note written through the real Organize lands in the real CouchDB in the LiveSync doc-format (metadata + chunk docs), so that the real Organize→write path is verified end-to-end.
15. As the maintainer, I want a one-command CouchDB to run the test against, so that I do not have to stand one up by hand (reusing the Seam B compose file).
16. As the maintainer, I want the test documented in the issue tracker and runnable with a documented command, so that another session or contributor can reproduce it.
17. As the user dogfooding the app, I want the maintainer to have verified the real LLM path before I capture real thoughts, so that I am not the first to discover the cloud plumbing is broken.

## Implementation Decisions

- **Reuse the existing operation-layer seam; introduce no new seam.** Seam C drives the public entry points `organizeDump` and `retrieve` as black boxes — the same seam Seam A and Seam B use — at its highest point. The only change versus Seam A is that the cloud deps and the `DocStore` are real instead of fakes. No module in `src/` is added or modified; this is test-only (mirrors ticket 07).
- **Real cloud implementations are wired, not fakes.** The test passes `organizer: createOrganizer(settings)`, `embedder: createEmbedder(settings)`, `answerer: createAnswerer(settings)`, and `db: createRemoteDb(settings)` into the operation-layer deps. These issue real `fetch` calls to the Ollama-compatible `/api/chat` (with `format: 'json'`) and `/api/embed` endpoints.
- **Env-gated, mirroring Seam B.** The whole suite is `describe.skip` unless `LLM_SMOKE=1`, so the default `npm test` stays green with no live LLM/CouchDB. The skip is visible in the output.
- **Credentials and endpoints from the environment.** The Ollama-compatible endpoint comes from `LLM_PROVIDER` (base URL), `LLM_MODEL`, `LLM_API_KEY`, and `EMBEDDER_MODEL`. The CouchDB comes from the Seam B vars (`COUCHDB_URL`, `COUCHDB_USER`, `COUCHDB_PASSWORD`, `COUCHDB_DB`). Settings are assembled from these and passed through the same `Settings` shape the app uses.
- **Throwaway CouchDB.** The test reuses `docker-compose.smoke.yml` and creates/destroys its own database each run (the same lifecycle Seam B uses), so runs are isolated and repeatable.
- **Assertion philosophy: structure, types, non-emptiness — never exact content.** A real model is non-deterministic. The test asserts: `OrganizeOutput` has every field present and correctly typed (title non-empty string, tags non-empty array, category/summary non-empty strings, keyPoints/related non-empty arrays, body non-empty string); the Embedder returns numeric vectors of equal length for every doc and the question; `AnswerOutput` is a non-empty answer string plus a `sources` array of integers in range; the `RetrieveResult` answer is non-empty and every citation's `path` corresponds to a file actually written to the vault.
- **The full loop is the point.** The test captures a Dump, Organizes it with the real Organizer, writes the Note to the real CouchDB, then Retrieves a question whose answer should draw on that Note, and asserts the Note's path appears among the citations. This is the integration no fake can substitute for.
- **No exact-string or semantic-correctness assertions.** The test does not assert the Organizer's title equals a fixed string, nor that the answer is semantically "correct" — both are non-deterministic and would be flaky. It asserts the contract the operation layer depends on (shape + presence), not model quality.
- **Cost awareness.** Each run makes a handful of real LLM calls (one Organize, one embedding batch, one answer). The test is opt-in, so cost is incurred only on deliberate verification runs.

## Testing Decisions

- **What makes a good test here.** Assert only external behavior through the operation layer (`organizeDump`, `retrieve`) with the **real** cloud and CouchDB deps. The cloud LLM/embedder is NOT stubbed — that is the entire purpose. Because the model is non-deterministic, assertions are on structure, types, and non-emptiness, never on exact output. This is the LLM/embedder analogue of Seam B: Seam B pinned the LiveSync doc-format contract against a real CouchDB; Seam C pins the cloud-seam contract against a real provider.
- **Modules under test.** The real cloud wiring (`createOrganizer` / `createEmbedder` / `createAnswerer` — prompt building, the Ollama-compatible fetch, strict-JSON parsing, embedding shape) exercised through `organizeDump` and `retrieve`; and the real CouchDB write/read through `createRemoteDb`. Internal helpers are exercised only through these operations, consistent with Seam A's pattern.
- **Prior art.** `tests/livesync-smoke.test.ts` (Seam B / ticket 07) — the env-gating pattern (`describe.skip` unless an env var), the throwaway-CouchDB create/destroy lifecycle, the `docker-compose.smoke.yml` reuse, and the "assert the contract, not app logic" stance are all lifted from it. The Seam A tests (`tests/operations.test.ts`, `tests/retrieve.test.ts`) supply the shape expectations the real seams must meet (the `OrganizeOutput` / `AnswerOutput` / `RetrieveResult` shapes the fakes satisfy).
- **Gate and credentials.** Skipped unless `LLM_SMOKE=1`. Cloud + CouchDB config read from env vars; secrets never written to disk or committed. Documented run command in the test file header, as Seam B does.

## Out of Scope

- **Provider portability (OpenAI / Anthropic / Gemini).** The cloud seam stays Ollama-compatible for v1. Making it provider-portable is a separate architectural decision (possibly ADR-worthy) and a separate ticket; Seam C verifies the Ollama path only.
- **Exact-output or semantic-correctness assertions.** Non-deterministic; not assertable without flakiness.
- **The real-vault LiveSync sync demo.** Capturing against the user's actual LiveSync vault to watch a Note sync into Obsidian is a manual dogfood step performed *after* Seam C is green, not a committed automated test.
- **Exposing `hashAlgorithm` / `dumpsFolder` in the config UI.** Separate concern; Seam C uses the `sha1` / `_dumps` defaults.
- **Voice capture and voice questions.** Deferred to iteration 2 (per the v1 spec).
- **A persistent vector index.** v1 remains re-embed-on-query.
- **Changes to `src/`.** This ticket is test-only; no app behavior changes (consistent with ticket 07).

## Further Notes

- **Risk framing.** The real cloud LLM/embedder seam is the biggest untested external risk in the app, directly analogous to the LiveSync-format coupling risk ADR-0001 calls out and Seam B mitigates. Seam C is the cloud-side counterpart: it pins the contract the operation layer depends on (typed, non-empty model output) against a real provider, so a drift in the cloud plumbing or the provider's response shape is caught before a user sees it.
- **ADR candidate (deferred).** If v1 later *commits* to the Ollama-compatible endpoint as the supported cloud model (rather than making the seam provider-portable), that choice is ADR-worthy: surprising without context (the config UI reads "provider / model / API key" generically but the plumbing is Ollama-locked) and the result of a real trade-off (Ollama-only simplicity vs. provider portability). This ticket does not make that decision — it verifies the Ollama path so the decision can be made on evidence.
- **Domain vocabulary.** This spec uses the terms defined in `CONTEXT.md` (Brain-dump, Dump, Context, Note, Organize, Retrieve, Modality). The "cloud LLM" the config UI names is, in v1, an *Ollama-compatible model endpoint* — an implementation detail, not a glossary term, so it stays out of `CONTEXT.md`.
- **Run command** (documented in the test header):
  ```
  docker compose -f docker-compose.smoke.yml up -d
  LIVESYNC_SMOKE=1 LLM_SMOKE=1 \
    COUCHDB_URL=http://localhost:5984 COUCHDB_USER=admin COUCHDB_PASSWORD=password \
    LLM_PROVIDER=https://your-ollama-host LLM_MODEL=your-model LLM_API_KEY=your-key \
    EMBEDDER_MODEL=your-embedder-model \
    npx vitest run tests/llm-smoke.test.ts
  ```
  (`LIVESYNC_SMOKE=1` is included because Seam C reuses the Seam B CouchDB lifecycle.)

## Comments

- Implemented as `tests/llm-smoke.test.ts`: env-gated on `LLM_SMOKE=1` (the whole suite is `describe.skip` otherwise, so `npm test` stays green with no live LLM or CouchDB — verified: 63 passed, 8 skipped). Wires the REAL `createOrganizer` / `createEmbedder` / `createAnswerer` + `createRemoteDb` into the existing `organizeDump` / `retrieve` operation-layer seam (no new seam, no `src/` changes). Four tests: the real Organizer (typed non-empty `Note`), the real Embedder (equal-length numeric vectors for every document AND the question), the real Answerer (non-empty answer + in-range source indexes), and the full loop (real Organize → Note written to the real CouchDB in LiveSync doc-format → real Retrieve → non-empty answer + no dead-link citations). All assertions are on structure/types/non-emptiness, never exact strings.
- Credentials stay in the environment: `LLM_PROVIDER` / `LLM_MODEL` / `LLM_API_KEY` / `EMBEDDER_MODEL` + the Seam B `COUCHDB_*` vars. Defaults point at a local Ollama + the Seam B throwaway CouchDB so the documented one-command run works out of the box; secrets never enter the repo. Reuses `docker-compose.smoke.yml` and creates/destroys its own database each run.
- **Live run is environment-dependent and is the user's step.** A live run needs a running Ollama-compatible endpoint with a chat model AND an embedding model. The local Ollama here has chat (`glm-5.2:cloud` returns valid strict JSON for the Organizer/Answerer prompts) but no embedder (`glm-5.2:cloud` embed → unauthorized; `llama3.2` needs `--embeddings`; no `nomic-embed-text` pulled), and the API key / a running Ollama are not present in this session's shell. So the full live loop could not be executed here. The test is verified to (a) typecheck clean, (b) be skipped by default, (c) not disturb the green default suite. Running it green against a real provider + an embedder model + a throwaway CouchDB is the deliberate verification run the spec describes (run command in the test header and in Further Notes above).
- Code review (two-axis) surfaced four spec gaps, all fixed before commit: (1) `keyPoints` and `related` are now asserted non-empty, not just typed (story 10); (2) the Embedder test now embeds the question alongside the documents and asserts one equal dimension across all four (story 11); (3) the Organizer test now asserts the written Note lands in the real CouchDB in the LiveSync doc-format via `assertLiveSyncFile` (metadata + chunk docs), not just via a content read-back (story 14); (4) the run command in the test header now includes `LIVESYNC_SMOKE=1` as the spec documents. The Standards axis flagged cross-file duplication with `livesync-smoke.test.ts` (`sha1Hex` / `fixedHash` / `RemoteDb` / the `describe.skip` gate / the doc-format assertion) — resolved by extracting `tests/_smoke-helpers.ts`, now shared by both smoke tests (one source of truth for the LiveSync format contract). `livesync-smoke.test.ts` was refactored to import from it; its skip path + typecheck remain green.

- The first live Seam C run (OpenRouter, `deepseek/deepseek-v4-flash` chat +
  `openai/text-embedding-3-small` embeddings, throwaway CouchDB) passed 3 of 4 and caught a
  contradiction between this ticket and the app: story 10 asked for a **non-empty**
  `related`, but the Organize prompt in `src/lib/llm.ts` specifies
  `related: Obsidian wikilinks or URLs, empty if none`. Organizing the sample dump ("I keep
  forgetting to water the basil on the windowsill") in isolation, the model correctly
  returned `[]` and the test failed. The prompt is right and story 10 was wrong: the
  Organizer is shown a single Dump and not the vault, so "what does this relate to" has a
  legitimate empty answer, unlike title/tags/category/summary/keyPoints/body which are
  always derivable. Asserting non-empty would have demanded fabricated wikilinks — dead
  links written into the vault, the class of bug ticket 06 hunted down. Fixed by dropping
  the `related.length` assertion (shape and element types still asserted) and amending
  story 10. `CONTEXT.md`'s **Organize** entry now records that related links are the one
  optional output.
- Everything else in the run was green on the first live attempt: the real Organizer parsed
  onto `OrganizeOutput`, the real Embedder returned equal-length numeric vectors for every
  document and the question, the real Answerer returned an answer with in-range source
  indexes, and the full loop wrote a Note to a real CouchDB in LiveSync doc-format, read it
  back, ranked it, and cited it. The OpenAI-compatible seam (ADR-0003) is verified against a
  live provider.

# The cloud seam speaks the OpenAI-compatible API (not Ollama-native)

The cloud LLM/embedder plumbing in `src/lib/llm.ts` talks to the provider through the
**OpenAI-compatible API** (`/chat/completions` with `response_format: { type: 'json_object' }`,
and `/embeddings`), not Ollama's native `/api/chat` + `/api/embed`. `llmProvider` holds the
full OpenAI-compatible base URL (e.g. `https://openrouter.ai/api/v1`).

## Context

v1's cloud seam was originally written Ollama-native (ADR-0001's world assumed an
Ollama-compatible host). Ticket 08's Seam C smoke test was built to verify that path — but
it could never run live: the available Ollama cloud model has chat but **no embedding
model** (no Ollama cloud embedder exists), so the full Organize → embed → Retrieve loop was
un-runnable. The user wants cloud models via OpenRouter, which lists embedding models
(`text-embedding-3-small`, Qwen3 embeddings, Gemini embedding, …) accessed through its
OpenAI-compatible API. Ticket 08 explicitly deferred this decision as a separate,
ADR-worthy ticket.

## Considered options

- **Add a second protocol behind an `llmProtocol: 'ollama' | 'openai'` selector** — keep
  Ollama-native and add OpenAI-compatible. Rejected: two request/response code paths to
  maintain, and the Ollama-native path's cloud story is dead (no cloud embedder). The
  selector adds a Settings field + UI for a path that no longer earns its keep.

- **OpenAI-compatible only** (chosen). One path. It is the universal cloud interface: it
  works against OpenRouter, OpenAI, Groq — and a local Ollama too, which exposes an
  OpenAI-compatible endpoint at `http://localhost:11434/v1`. So nothing the Ollama-native
  path could do is lost; the same base URL convention covers every provider.

## Consequences

- `llmProvider` is the full OpenAI-compatible base URL (must include `/v1` or `/api/v1`,
  depending on the provider), not a bare host. The config UI placeholder reflects this
  (`https://openrouter.ai/api/v1`).
- The chat request sends `response_format: { type: 'json_object' }`, so the chosen chat
  model must support JSON mode. The existing `stripFences` + `JSON.parse` tolerance in the
  parsers remains as the safety net for models that return JSON without strict mode.
- Embeddings are reordered by the provider's `index` field before use — a provider that
  returns them out of order would otherwise silently mis-rank the vault against the query.
- `llm.ts` is no longer "not unit-tested": `tests/llm-provider.test.ts` pins the
  request shape + response parsing for the OpenAI-compatible path (the live smoke test
  needs a real provider + key and stays opt-in).
- This reverses ticket 08's "stays Ollama-compatible for v1" stance. The decision is made
  on evidence (the Ollama cloud path is unusable for embeddings) rather than deferred.
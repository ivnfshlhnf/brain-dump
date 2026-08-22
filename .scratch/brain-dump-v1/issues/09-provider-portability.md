# 09 — Provider portability: OpenAI-compatible cloud seam

**What to build:** Replace the Ollama-native cloud plumbing in `src/lib/llm.ts` with a single
OpenAI-compatible path (chat `/chat/completions` + `response_format`, embeddings `/embeddings`),
so the app can use cloud providers that have an embedding model (e.g. OpenRouter). Records
the decision ticket 08 deferred as ADR-0003.

**Blocked by:** 08 — Real cloud LLM/embedder smoke test (Seam C surfaced the Ollama-cloud-has-no-embedder blocker and flagged provider portability as a separate ADR-worthy ticket).

**Status:** done

- [x] `src/lib/llm.ts` chat + embed talk the OpenAI-compatible API, not Ollama-native. *(Chat POSTs `{base}/chat/completions` with `{model, stream:false, response_format:{type:'json_object'}, messages}` and parses `choices[0].message.content`; embeddings POST `{base}/embeddings` with `{model, input}` and parse `data[].embedding` reordered by `index`. `authHeaders` was already Bearer-compatible. `llmProvider` is the full OpenAI-compatible base URL, e.g. `https://openrouter.ai/api/v1` or `http://localhost:11434/v1` for a local Ollama.)*
- [x] The Ollama-native path is removed (no `llmProtocol` selector). *(Single path; the OpenAI-compatible endpoint also covers local Ollama via `/v1`, so nothing the native path could do is lost. See ADR-0003 for the rejected two-protocol option.)*
- [x] The request shape is unit-tested without a network. *(`tests/llm-provider.test.ts` stubs `globalThis.fetch` and asserts both the chat request (`/chat/completions`, `response_format`, Bearer auth, `choices[0].message.content` parse) and the embedder request (`/embeddings`, `{model,input}`, `data[].embedding` reordered by index). 5 tests, green. This is the only verification runnable without a live provider/key; the smoke test stays opt-in.)*
- [x] Config UI + smoke test defaults point at an OpenAI-compatible provider. *(App.svelte placeholders: `https://openrouter.ai/api/v1`, `openai/gpt-4o-mini`, `openai/text-embedding-3-small`. `tests/llm-smoke.test.ts` header run command + defaults updated to OpenRouter; no `LLM_PROTOCOL` env var.)*
- [x] Decision recorded as ADR-0003. *(`docs/adr/0003-provider-portability-openai-compatible.md` — context, considered options, consequences.)*

## Comments

- The full live Seam C run against OpenRouter (cloud chat + cloud embeddings + a throwaway CouchDB) remains the user's deliberate step — it needs an OpenRouter API key in the caller's shell and a chosen chat model that supports JSON mode (`response_format: { type: 'json_object' }`). The smoke test is verified to typecheck, skip by default, and keep the default suite green (63 + 5 provider tests passed, 8 skipped). Run command is in the `tests/llm-smoke.test.ts` header.
- This reverses ticket 08's "stays Ollama-compatible for v1" stance. Ticket 08's spec framed provider portability as ADR-worthy and deferred; this ticket makes the call on evidence (Ollama cloud has no embedding model → the native path is unusable for the full loop) and records it in ADR-0003. Ticket 08's own doc remains as-written (its "Out of Scope" reflects what was true when it was written; this ticket is the follow-up it anticipated).
# Brain-dump

Capture a thought the moment it strikes, let it organize itself, and ask questions
about it months later — all inside the Obsidian vault you already use.

A single-user PWA. You type a thought; the app saves the raw text immediately, uses a
cloud LLM to turn it into a titled, tagged, summarized **Note**, and writes both
straight into your Obsidian LiveSync CouchDB so they sync to every device. Later you
ask a question in plain language and get a synthesized answer with citations back to
the Notes it drew from — not a file list.

**Status:** v1 (text-only) is feature-complete. Voice capture is deferred to iteration 2.

## Why

Fleeting thoughts are easy to have and hard to capture. By the time you open a note app,
pick a folder, and invent a title, the thought is gone. Tools that don't make you organize
upfront tend to store the dump somewhere disconnected from the knowledge base you actually
use, so months later you can't find "that thing I was thinking about X."

Brain-dump splits the two jobs. Capture is instant and lossless — the raw text hits the
vault before anything else happens. Organizing is the app's problem, not yours. And because
everything lands in your real vault, retrieval draws on your whole knowledge base, not a
walled-off dump pile.

## How it works

**Capture** → your text is written to the vault as a **Dump** (verbatim, immutable once
saved) → an initial **Organize** runs and shows you a preview of the **Note**, alongside a
suggestion of whether this founds a new Note or should **Append** to an existing one → you
can add **Context**, which edits the Dump while preserving your verbatim original inside it
→ five seconds after you stop typing (or when you close the tab) the Note is re-organized
from the full Dump, written, and the Dump is frozen.

**Retrieve** takes a question, reads your entire vault, embeds it fresh, ranks the top 5
documents, and asks the model to synthesize an answer citing them.

**Offline**, a capture is queued in an IndexedDB outbox and shows "saved, will organize when
online." On reconnect it syncs and Organizes automatically.

Two folders are written, and only two: `Brain Dump/` for Notes and `_dumps/` for raw Dumps.
Retrieve *reads* your whole vault, including personal notes — the app never writes outside
its own two folders.

The vocabulary above is precise and load-bearing. **Dump**, **Note**, **Context**,
**Organize**, **Append**, **Retrieve**, **Capture**, **Modality** are defined in
[`CONTEXT.md`](./CONTEXT.md); code and tests use the same words.

## Requirements

- Node 18+ and npm (developed on 18.20)
- An **Obsidian vault synced with [Self-hosted LiveSync](https://github.com/vrtmrz/obsidian-livesync)** backed by CouchDB you can reach over HTTP
- An **OpenAI-compatible LLM provider** with both a chat model and an embedding model
  (OpenRouter, OpenAI, Groq, or a local Ollama via `http://localhost:11434/v1`)
- Docker, only if you want to run the smoke tests

> **The vault must be unencrypted.** LiveSync's end-to-end encryption and path
> obfuscation are incompatible with external writes — see
> [ADR-0001](./docs/adr/0001-live-sync-couchdb-direct.md).

## Getting started

```bash
npm install
npm run dev
```

Open the app, go to **Config**, and fill in:

| Field | What it is |
| --- | --- |
| CouchDB URL | Your LiveSync CouchDB, e.g. `https://couch.example.com` |
| Database | The LiveSync database name |
| Username / Password | CouchDB credentials |
| Managed folder | Where Notes go. Default `Brain Dump` |
| Case-sensitive | Must match LiveSync's "Handle files as Case-Sensitive" setting (its default is **off**) |
| LLM provider | The **full** OpenAI-compatible base URL, including scheme and version path. Defaults to `https://openrouter.ai/api/v1`. A value without a scheme resolves against the app's own origin and every LLM call 404s |
| LLM model | Must support `response_format: { type: 'json_object' }`. Defaults to `deepseek/deepseek-v4-flash` |
| LLM API key | Your provider key — the only cloud field with no default |
| Embedder model | Defaults to `openai/text-embedding-3-small` |

The cloud fields ship with working defaults, so in practice you fill in CouchDB and your API
key. Settings persist in IndexedDB, so you enter them once per device.

Press **Test connection** to check CouchDB, the chat model, and the embedder independently
before capturing anything. The two cloud checks each make one small real request and spend a
fraction of a cent.

> **Credentials are stored in IndexedDB in plaintext.** That is an accepted trade-off for a
> single-user personal app on a device you control; the app is not XSS-hardened. Don't host
> it on a domain you share with untrusted content.

The three nav tabs are **Capture**, **Ask**, and **Config**.

## Testing

Three seams, in increasing cost and decreasing isolation.

```bash
npm test          # Seam A — the default suite. No network, no LLM, no Docker.
npm run typecheck # svelte-check
npm run build     # typecheck + production build
```

**Seam A** drives the operation layer (`capture`, `organize`, `append`, outbox, `retrieve`)
as black boxes against an in-memory PouchDB and deterministic LLM fakes. It asserts the
app's orchestration, never model output. This is what runs by default and what should stay
green.

**Seam B** (`tests/livesync-smoke.test.ts`) writes to a real CouchDB and asserts LiveSync's
reader accepts the documents — pinning the format contract that ADR-0001 depends on.

**Seam C** (`tests/llm-smoke.test.ts`) runs the real cloud Organizer, Embedder, and Answerer
against a live provider and a real CouchDB, end to end. Assertions are on structure and
non-emptiness, never exact strings, because the model is non-deterministic.

> **Never put your real vault's database in `.env`.** Both smoke suites call `destroy()` on
> whatever `COUCHDB_DB` names — before *and* after the run. That is what makes them
> repeatable, and it would silently delete your entire vault. `.env` is for throwaway test
> databases only; your real vault belongs in the app's Config screen, nowhere else.

Both smoke suites are **skipped unless their env gate is set**, so a fresh checkout is green
with no Docker and no API key. To run them:

```bash
cp .env.example .env    # then fill in LLM_MODEL and LLM_API_KEY
set -a && source .env && set +a
docker compose -f docker-compose.smoke.yml up -d
npx vitest run tests/livesync-smoke.test.ts tests/llm-smoke.test.ts
docker compose -f docker-compose.smoke.yml down
```

`.env` is gitignored; keys never enter the repo. Each smoke test creates and destroys its
own database, so runs leave nothing behind and repeat cleanly.

## Diagnostics

When something goes wrong against a real vault, the app records a structured event log:
what it tried, against which **resolved** URL, and what came back.

- **In the app**: Config → *Diagnostics* lists recent events, with a **Copy** button.
- **On disk (dev only)**: every event is also appended to `logs/brain-dump.jsonl`, one JSON
  object per line — greppable by you, parseable by an agent:

  ```bash
  tail -f logs/brain-dump.jsonl                     # follow live
  jq -c 'select(.level=="error")' logs/brain-dump.jsonl   # just the failures
  ```

The file is written by a Vite dev middleware (`devLogFile()` in `vite.config.ts`), since a
browser cannot write to the project folder. A production build has no such endpoint — the
in-memory buffer is all that remains. `logs/` is gitignored.

Events carry paths, lengths, and outcomes — never Dump or Note content, and never
credentials — so the log is safe to paste into a conversation.

## Project layout

```
src/lib/operations.ts   the operation layer — capture, organize, append, match
src/lib/retrieve.ts     RAG: embed the vault, rank, synthesize, cite
src/lib/livesync.ts     LiveSync document format — metadata + content-addressed chunks
src/lib/llm.ts          the cloud seam (OpenAI-compatible)
src/lib/outbox.ts       the offline queue
src/App.svelte          a thin UI shell over the operation layer
```

The UI is deliberately thin. The operation layer is the unit the UI calls and the unit under
test — behavior lives there, not in the component.

## Documentation

- [`CONTEXT.md`](./CONTEXT.md) — the domain glossary. Start here.
- [`docs/adr/`](./docs/adr/) — architecture decisions and why the alternatives lost:
  - [0001](./docs/adr/0001-live-sync-couchdb-direct.md) — write to LiveSync's CouchDB directly, in its internal document format
  - [0002](./docs/adr/0002-retrieval-whole-vault-writes-managed-only.md) — retrieve over the whole vault, write only to managed folders
  - [0003](./docs/adr/0003-provider-portability-openai-compatible.md) — the cloud seam speaks the OpenAI-compatible API
  - [0004](./docs/adr/0004-embedding-cache-sibling-database.md) — vault embeddings are cached in a sibling CouchDB database
- [`.scratch/brain-dump-v1/spec.md`](./.scratch/brain-dump-v1/spec.md) — the full v1 spec and the tickets it was built from
- [`AGENTS.md`](./AGENTS.md) — conventions for agents working in this repo

## Known limitations

- **Text only.** Voice capture and spoken answers are iteration 2.
- **No persistent vector index yet.** Every Retrieve re-embeds the whole vault, so query cost
  and latency grow with vault size. A content-addressed cache in a sibling CouchDB database is
  specified in [ADR-0004](./docs/adr/0004-embedding-cache-sibling-database.md) and the
  related-notes feature's ticket 01.
- **A Note's `## Related` section is always empty.** The Organizer is only ever shown the
  Dump's own text, never the vault, so it cannot name a Note it has never seen. The
  related-notes feature's ticket 02 fixes this by ranking against the vault instead of
  asking the model to guess.
- **Retrieval sends your personal notes to the cloud provider**, not just your brain-dumps —
  a direct consequence of ADR-0002 plus a cloud LLM. Accepted for v1.
- **The app depends on LiveSync's internal document format**, for which no official
  external-write API exists yet ([issue #795](https://github.com/vrtmrz/obsidian-livesync/issues/795)).
  A format change upstream could break writes; Seam B exists to catch that early.
- **Single-user.** No multi-user or shared-vault support.

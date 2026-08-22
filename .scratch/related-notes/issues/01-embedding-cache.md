**Status:** ready-for-agent

# 01 — Persistent embedding cache in a sibling CouchDB database

**What to build:** A content-addressed cache of vault-document embeddings, stored in an
app-owned CouchDB database alongside the vault database, so a document is embedded once
ever rather than once per interaction. Unblocks ticket 02 (Related) and removes Retrieve's
known scaling cliff.

**Blocked by:** nothing.

**Blocks:** 02 — populate Related.

## Problem Statement

v1 deliberately shipped without a vector index: every Retrieve reads the whole vault and
re-embeds it from scratch (`src/lib/retrieve.ts`, spec §Out of Scope — "a persistent
`_changes`-fed index is a later optimization when query latency demands it").

Ticket 02 makes that demand arrive. Populating a Note's Related links means ranking the new
Note against the vault, over the **whole** vault, on every capture — so the app would embed
the entire vault twice per interaction (once per question, once per capture) instead of
once. At `openai/text-embedding-3-small` pricing of $0.02 per million input tokens, a
2,000-note vault costs roughly $0.02 per full embed; at ten captures and five questions a
day that is ~$9/month, growing linearly with the vault. Cost is survivable; latency is not.
Embedding thousands of documents takes seconds, and Related is computed on the capture path,
whose entire purpose is to feel instant.

Every document is also re-embedded despite not having changed. The app already computes a
content hash for every file — the LiveSync chunk id (`h:` + hash) — so the information
needed to skip unchanged documents is already in hand and thrown away.

## Solution

An embedding cache keyed by content hash, stored in a **sibling CouchDB database** (default
`brain-dump-embeddings`) on the same server as the vault. Before embedding a batch, the app
looks up each document's content hash; hits are served from the cache and only misses go to
the provider. Results are written back.

The cache is app-owned plain CouchDB documents — **not** LiveSync format and **not** in the
vault — so it never appears in Obsidian, never syncs float blobs to a phone, and does not
depend on the internal document format ADR-0001 flags as the project's biggest external
risk. Because every device points at the same CouchDB, one device's embedding work serves
all of them.

Vectors are stored **base64-encoded float32**: lossless, so ranking is bit-identical to the
uncached path, and ~8 KB per 1536-dimension vector versus ~20 KB as JSON floats.

## User Stories

1. As the user, I want a document embedded only once, so that repeated questions and
   captures do not pay to re-embed a vault that has not changed.
2. As the user, I want an edited document re-embedded automatically, so that ranking
   reflects what the document says now.
3. As the user, I want the cache shared across my devices, so that my phone benefits from
   embedding work my laptop already did.
4. As the user, I want the cache kept out of my Obsidian vault, so that my vault stays notes
   and does not sync megabytes of vectors to my phone.
5. As the user, I want ranking with the cache to be identical to ranking without it, so that
   caching is a speed change and never an answer change.
6. As the user, I want the app to work when the cache is unavailable, so that a missing
   database degrades speed rather than breaking Retrieve.
7. As the maintainer, I want the cache database name configurable, so that it can be pointed
   somewhere else on a shared CouchDB.
8. As the maintainer, I want a stale entry to be harmless, so that a hash collision or a
   format change cannot silently corrupt ranking.

## Implementation Decisions

- **Storage: a sibling CouchDB database** (ADR-0004). Default name `brain-dump-embeddings`,
  configurable. Plain app documents, not LiveSync format. Rejected alternatives and why are
  in the ADR.
- **Key: the content hash already computed for the chunk id.** One document per
  `(hash, embedder model)` pair — the model is part of the key, so switching embedder models
  invalidates cleanly instead of mixing incompatible vector spaces.
- **Encoding: base64 float32.** Lossless; `Float32Array` ↔ base64 both ways.
- **Seam: wrap the `Embedder`, do not change it.** A `createCachingEmbedder(inner, cache)`
  satisfies the existing `Embedder` interface, so `retrieve.ts` and ticket 02 are unchanged
  and the existing tests keep passing with a plain fake. `Embedder` is already a dependency
  seam of the operation layer, so this introduces **no new seam**: the caching embedder is
  injected at Seam A like any other fake.
- **Degradation: a cache failure is never fatal.** A read or write error against the cache
  database is logged and falls through to embedding normally — the diagnostics log records
  it so a silently-disabled cache is visible rather than mysterious.
- **Build-time check: resolved.** Test connection was run against the real server on
  2026-08-23 and reported that the account may create a database. Build the sibling-database
  path; the per-device fallback is not needed here and should not be implemented speculatively.
  Keep the failure path graceful — if the database cannot be reached or created at runtime, log
  it and embed normally — but do not build a second storage backend on spec.

## Testing Decisions

- Seam A, not a new seam: drive `retrieve` (and the finalize path) as black boxes with a
  caching embedder wrapping a **counting fake** inner embedder, against an in-memory PouchDB.
  Cache behaviour is asserted through the operation layer's observable results plus the inner
  fake's call count — never by reaching into the cache module.
- A second call for the same content must not reach the inner embedder; changed content
  must; the returned vectors must equal the uncached vectors exactly.
- A cache database that throws must still produce correct embeddings.
- Switching `embedderModel` must not return vectors computed under the previous model.

## Out of Scope

- A `_changes`-fed live index — this is a lazy read-through cache, not a subscription.
- Approximate nearest neighbour / vector search. Ranking stays exact cosine over the
  candidate set; the cache changes only where vectors come from.
- Pre-warming the whole vault in the background.
- Quantisation. Considered and rejected: it trades exact ranking for bytes not worth saving.

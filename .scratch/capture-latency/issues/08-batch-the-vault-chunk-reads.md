**Status:** built, awaiting the phone acceptance number

## Comments

2026-09-02 — built as specified. `readVaultFiles` now scans the metadata, collects the chunk
ids of every included, live document, and fetches them with one `allDocs({ keys })`, zipping
the rows back onto the keys (CouchDB answers a keys query in key order). A missing chunk
throws and fails the whole read, as `db.get`'s 404 did; a counting `DocStore` decorator in
`tests/livesync.test.ts` pins the property the ticket is about — a vault with single-chunk
files, a LiveSync-style multi-chunk file, an excluded path and a soft-deleted file reads
with **zero** `db.get` calls and exactly two `allDocs` calls — plus the missing-chunk
rejection. 295 tests pass, svelte-check clean.

One consequence reached past the unit seam: the two browser checks that mock the Vault
(`check-committed-sheet`, `check-recovery-refresh`) answered `GET _all_docs` only, so the
batched read's `POST _all_docs` fell through to their per-id branch and would have
mis-aligned rows. The duplicated route handler is now one `handleCouch` in
`scripts/lib/check-harness.mjs` — which answers the keys form in key order with an `error`
row for a missing key — and both checks use it. All 9 browser checks pass through the
batched path.

# 08 — Batch the vault chunk reads

**What to build:** `readVaultFiles` fetches every chunk with a separate `db.get`. Fetch them
all in one `db.allDocs({ keys })` round trip instead.

**Blocked by:** nothing — this is a finding from the phone log, not a design question.

## Problem Statement

The phone capture of 2026-09-02 10:47 (ticket 02's recorded numbers) measured the same cost
twice, independently, in one capture: **~13.4s of vault read before the Related pass could
even embed**, and **~13.4s again between the append's re-organize resolving and its embed
batch starting**. The cause is mechanical, in `readVaultFiles` (`src/lib/livesync.ts:154`):

```ts
const chunks = await Promise.all(
  doc.children.map((id) => db.get<{ data: string }>(id)),
);
```

One CouchDB round trip per chunk, files read sequentially in the `for` loop. The metadata
scan above it is already a single `allDocs`; only the chunks pay per-document. At ~61 vault
documents and ~200ms per round trip on the phone's tailscale link, that is the 13 seconds.

Who pays it, per capture:

- **The preview's Related pass** — the pass starts at preview time, but the vault read alone
  overran ticket 04's entire 5s deadline; the log shows the deadline expiring while the pass
  was still reading, before the judge request existed. The deadline is not too short; its
  preamble is too long.
- **The Match** — ~4.4s of the same read before its request went out, so the new-vs-append
  decision arrived 20.2s after capture start and gated the autosave the whole time.
- **The append path's `fillRelated`** — the second 13.4s, between the re-organize resolving
  and the embed batch starting; the user waited 23.1s from tapping Append to links written.
- **Retrieve's Ask and reconciliation** — same read, same tax, every time.

The provider calls are not the bottleneck on the phone path any more. This read is.

## Solution

Collect the chunk ids of every included, live document after the metadata scan, fetch them
all with **one** `db.allDocs({ keys: chunkIds, include_docs: true })`, build an id → data
map, and reassemble exactly as today. The round-trip count becomes proportional to the
number of requests, not the number of documents: two per vault read (metadata scan + chunk
batch) regardless of vault size.

Nothing else changes — not the `include` filter's "no chunk fetched for an excluded path"
property, not the soft-delete exclusion, not the children-in-order concatenation, not
`readVaultDocs` or any caller. `DocStore.allDocs` already accepts `keys`
(`src/lib/types.ts:255`), so no interface grows.

## User Stories

1. As the user, I want Related links and Ask answers without a 13-second tax before the
   model is even asked, so that the phone behaves like the desktop.
2. As the user, I want the append I confirmed to finish fast, so that filing is the end of
   the interaction rather than another wait.
3. As the maintainer, I want the round trips bounded by the operation, not the vault, so
   that the app does not get slower as the vault grows.

## Implementation Decisions

- **A missing chunk fails the read exactly as today.** `db.get` rejects on a 404 and
  `Promise.all` rejects the whole read; `allDocs` returns a row with no `doc` for a missing
  key, and the read throws the same way. No silent skip: a vault read that quietly omitted a
  file would mis-rank Related and mis-answer Ask, and every caller already has an honest
  degradation for a failed read ("file without links", "no answer").
- **Chunk ids are deduplicated before the request.** Content-addressing means identical
  chunks are shared between files; the map, not the key list, is what reassembly reads.
- **No parallelism change elsewhere.** The `for` loop stays sequential over files; with one
  batch fetch it no longer matters.

## Testing Decisions

- **Seam A, black-box through `readVaultFiles`**, with a counting `DocStore` decorator around
  the memory PouchDB that tallies `get` and `allDocs` calls.
- **The round-trip property is the core assertion:** a vault of single-chunk files plus one
  multi-chunk file (LiveSync's own split format), with an excluded path and a soft-deleted
  file present, reads with **zero** `db.get` calls and **one** `allDocs`-with-keys chunk
  fetch, and returns byte-identical content to what the per-chunk read returns.
- **The missing-chunk property:** a metadata doc whose chunk is gone makes the whole read
  reject, as it does today.
- **Every existing suite must pass unchanged.** This ticket changes how many messages cross
  the wire, never what a read returns.
- **The acceptance is measured, not asserted:** ticket 02's record holds the before (two
  ~13.4s readings in one capture). At the next phone capture, record the after — the gap
  from `capture session ready` to the Related embed request, and from the append's
  re-organize resolving to its embed batch.

## Out of Scope

- The 5s Related deadline's mechanism, and whether it should be measured from the first LLM
  call instead of the pass's start — a design question this ticket deliberately does not
  settle; shrinking the preamble may answer it for free.
- Skipping the preview Related pass when the match looks like an append.
- Caching the vault read across callers within a capture.
- Anything about ranking, the floor, the cap, the embedder, or the judge.
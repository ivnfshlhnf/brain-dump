# Vault embeddings are cached in a sibling CouchDB database

The app keeps a persistent, content-addressed cache of vault-document embeddings in its own
CouchDB database (default `brain-dump-embeddings`) alongside the vault database — not in the
vault, and not per-device. Vectors are stored base64-encoded float32. This reverses the v1
scope decision to ship without a persistent vector index.

## Context

v1 deliberately had no vector index: every Retrieve re-embeds the whole vault, and the spec
listed a persistent index under Out of Scope as "a later optimization when query latency
demands it."

Populating a Note's Related links (ticket 11) makes that demand arrive. Related ranks a new
Note against the whole vault, on the capture path. Without a cache the app would embed the
entire vault twice per interaction — once per question, once per capture — at roughly $0.02
per full embed of a 2,000-note vault ($0.02/M input tokens for
`openai/text-embedding-3-small`), growing linearly. The recurring cost is survivable; the
seconds of latency on the path whose entire purpose is to feel instant are not.

Nearly all of that work is redundant: documents are re-embedded despite being unchanged, and
the app already computes a content hash for every file (the LiveSync chunk id) and discards
it for this purpose.

## Considered options

- **Store the cache in the vault** (e.g. an `_embeddings/` folder). Syncs to every device for
  free through LiveSync, and excluding it from Retrieve is a one-line predicate
  (`readVaultFiles` already takes an `include` filter). Rejected: at 1536 dimensions a
  2,000-note vault is ~16 MB of base64 float32 that Obsidian would sync to a phone and show
  in the file tree, and it would ride on LiveSync's internal document format — the coupling
  ADR-0001 names as the project's biggest external risk — for data that is not a note.

- **Per-device IndexedDB.** Simplest, no server concerns, no new permissions. Rejected as the
  default: each device pays a full vault embed of its own, so the phone gets no benefit from
  work the laptop already did. Retained as the **fallback** if CouchDB refuses database
  creation.

- **A sibling CouchDB database** (chosen). Shared across every device, since they all talk to
  the same CouchDB. Plain app-owned documents — no LiveSync format, so no coupling to
  ADR-0001's risk. The vault stays notes-only and Obsidian syncs nothing extra.

- **Quantise vectors to int8** (5× smaller again). Rejected: it trades exact ranking for
  bytes that are not scarce once the cache is out of the vault, and debugging a ranking
  change against a lossy cache is miserable.

## Consequences

- The app now owns a second CouchDB database. Its name is configurable, and the account must
  be able to create it — **not guaranteed**: the current user (`cemonk_couchdb`) is not an
  admin. If creation is refused the app falls back to per-device IndexedDB behind the same
  interface, trading one embed per vault for one embed per device.
- The cache key includes the embedder model, so changing `embedderModel` invalidates cleanly
  rather than mixing incompatible vector spaces.
- Base64 float32 is lossless, so ranking with the cache is bit-identical to ranking without
  it. Caching is a speed change and never an answer change — and that is a testable property.
- A cache failure degrades speed, never correctness: read/write errors fall through to
  embedding normally and are recorded in the diagnostics log, so a silently-disabled cache is
  visible rather than mysterious.
- This retroactively removes Retrieve's known scaling cliff, the largest limitation listed in
  the README — a benefit beyond the ticket that motivated it.
- It is a read-through cache, not a `_changes`-fed index. A document is embedded on first use
  after it changes, not proactively.

**Status:** ready

# 04 — Make the whole-vault embed call survive an oversized document

**What to build:** Harden `rankBySimilarity` (`src/lib/vault-search.ts`) so that one vault
document over the embeddings provider's per-input token limit cannot fail the entire ranking
pass. A failing document costs its own ranking entry, never the pass — and the skip is
recorded in the diagnostics log.

**Blocked by:** nothing. (Ordered after ticket 03 by the user's decision: 03 fixes the
observed failure, this hardens the path that has not failed yet.)

## Problem Statement

`rankBySimilarity` sends every vault document to the embeddings endpoint in **one request**
(`src/lib/vault-search.ts:56`, `embedder.embed(docs.map(embeddableText))`). The provider
rejects any single input over 8192 tokens with a 400, and one 400 fails the whole response:

```
400: "Invalid 'input[18]': maximum input length is 8192 tokens."
```

Confirmed live against the real provider, twice — including once when this diagnosis's own
harness reproduced it. Downstream, `fillRelated` (`src/lib/operations.ts:633`) catches the
throw and saves the Note with **no Related, silently** — the exact symptom of finding 08,
produced by a single long document. The same ranking call underlies Retrieve
(`src/lib/retrieve.ts:57`), so Ask dies with it.

Currently dormant by luck: the only grossly oversized files in the local vault
(`livesync_log_2026-08-25.md` is ~111 KB ≈ 28K tokens) are local-only and never reach the
CouchDB pool the app reads. But the pool contains accumulating documents (`random-notes`,
`coffee-log`), and one crossing the limit would silently empty every future Related section
and break Retrieve, with one log line as the only trace.

## Solution

On a failed batch, fall back to per-document requests; a document that fails even alone is
dropped from that ranking pass (no vector, cosine 0, excluded) and its path and failure are
logged. The ranking completes with the surviving documents; the Note is written with honest
Related from what could be ranked, and Retrieve degrades the same way. The batch fast path
stays exactly as it is — the fallback runs only when the batch call throws.

## User Stories

1. As the user, I want one long document to slow nothing and break nothing, so that my vault
   can accumulate large files without organizes or Ask silently failing.
2. As the user, I want a skipped document to be visible in the diagnostics log, so that a
   missing link has an explanation.
3. As the user, I want documents that fit to keep their full-text vectors, so that ranking
   quality is not paid for one oversized file.

## Implementation Decisions

- **Fix in `rankBySimilarity`, not in the embedder.** Both callers — Related and Retrieve —
  go through it, so one guard covers both. The `Embedder` interface is unchanged; the
  CachingEmbedder keeps working unchanged (the per-document fallback calls the same wrapped
  embedder and benefits from the cache as usual).
- **No truncation.** Embedding a prefix silently ranks a document by its first few thousand
  tokens, and bakes one provider's limit (8192) into the app. Dropping the document is honest:
  an unranked document cannot appear in a shortlist, and a cosine of 0 against it is the truth.
  (Also observed: content-dense files tokenize far worse than chars/4 heuristics suggest —
  a ~24K-character log still exceeded 8192 tokens — so any character cap would be either
  unsafe or uselessly conservative.)
- **Skip, log, continue.** The dropped document's path and the error go to the diagnostics
  log. A document the user cares about ranking can be split by hand; the app's job is to
  refuse to let it poison the rest.
- **The subject embed stays a single small call.** Only the vault-sized batch needs the
  fallback.
- **Chunking is not in scope.** Providers additionally cap total request tokens
  (qwen3-embedding rejected a 40,961-token batch); the per-document fallback already contains
  that failure mode, and speculative batch-sizing logic would add configuration for a
  failure the fallback handles.

## Testing Decisions

- Seam A, per the spec's testing decisions — assert on written Notes and returned rankings,
  never on internals.
- **A fake embedder that throws when given more than one text but succeeds per text:** the
  ranking completes and the Note is written with Related resolved from the ranked documents.
- **A fake embedder that throws for one specific document even alone:** that document is
  absent from the ranking, the rest rank normally, and the skip is observable (the returned
  ranking excludes it; the log records it).
- **All documents failing** degrades to an empty ranking (no Related, or Retrieve answering
  from nothing) rather than a thrown error escaping `fillRelated`'s contract.
- Unchanged behaviour pinned: the batch path is used when it succeeds (a counting fake sees
  one batched call), and cached vectors are used as before.

## Out of Scope

- Truncating or chunk-splitting oversized documents into multiple vectors per file.
- Per-provider token limits as configuration — the fallback makes exact limits unnecessary.
- A `_changes`-fed index or pre-warming (still out of scope per the original spec).
- The judge prompt — ticket 03.
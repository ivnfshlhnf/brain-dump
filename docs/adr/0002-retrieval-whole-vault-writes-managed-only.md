# Retrieval reads the whole vault; the app writes only its managed folders

The app writes only to `Brain Dump/` (organized Notes) and `_dumps/` (raw Dumps), leaving
the user's personal notes untouched. But Retrieve (RAG Q&A) indexes the **entire vault**,
including personal notes, so answers can draw on the user's full knowledge base.

## Considered options

- **Retrieve scoped to `Brain Dump/` only** — self-contained, personal notes never surface
  in brain-dump Q&A. Rejected: the user wants Q&A to span everything they know, not just
  brain-dumps.

## Consequences

- At query time the app must read (fetch + reassemble) **all** vault notes for re-embedding
  (v1 uses re-embed-on-query, no persistent index). This is heavier than a scoped read and
  is the main motivation for the later persistent-index migration.
- The app never writes outside `Brain Dump/` + `_dumps/`, so personal notes are safe from
  corruption — but they **are** sent to the cloud LLM/embedder during retrieval. This is
  consistent with the cloud-LLM decision (ADR-0001's world) and worth knowing: enabling
  RAG means the provider sees your personal notes too, not just brain-dumps.
- Retrieval's sources are the vault's **notes**, not the raw Dumps in `_dumps/`: a Dump's
  content is already represented by the Note Organized from it, so including both would
  double-count every brain-dump and cite an archive file the user does not browse. The
  consequence is that a Dump whose Note has not been written yet — a failed final save, or
  a capture still queued in the offline outbox — is not retrievable until it is Organized.

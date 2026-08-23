# Dogfooding findings

A running list of things noticed while actually using the app. Newest last.

Each entry records only what was **observed** — deliberately no "cause" or "fix" field.
Diagnosis happens later, in a spec, once a pattern is visible. Filing a cause at
observation time is how you end up fixing the wrong thing: the obvious explanations for
empty `## Related` were all plausible and all wrong (`.scratch/related-notes/spec.md`).

There is no threshold that converts this list into work. The user says when.

---

## 01 — The Note preview does not match the Note in the vault

**Date:** 2026-08-23

**What I saw:** After giving a Dump, the Note preview shown in the capture review looks
different from the Note that actually ends up in the vault.

**What I expected:** The preview to show me the Note I am about to save.

**Evidence:** Three code facts that could each produce a visible difference. Which one was
responsible on any given occasion is not yet established — check which applies next time it
happens.

- `finalizeCapture` (`src/lib/operations.ts:344`) calls `organizeNote` a second time at save,
  unconditionally, including when no Context was added. It is a separate LLM call over the
  same Dump, so title, tags, summary and key points need not match the preview's.
- Related links are resolved only at save (`withRelated`, `src/lib/operations.ts:366`). The
  preview makes no embedding call and renders no `## Related` section at all.
- On the `append` path the saved result is a dated section inside an existing Note, not a
  standalone Note (`appendDumpToNote`), so it is not the same kind of document as the preview.

**Times seen:** 1

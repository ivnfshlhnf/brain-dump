**Status:** ready

# 03 — Fix the Related judge's prompt

**What to build:** Replace the pessimistic clause in `buildRelatedPrompt`
(`src/lib/llm.ts:131-133`) with the positive relatedness criterion proven in the finding-08
bake-off. No model change, no ranking change, no data change — one prompt edit.

**Blocked by:** nothing.

## Problem Statement

The judge is the step that turns the embedding shortlist into `## Related` links, and its
prompt currently sabotages it. It says:

> Being about a similar subject is not enough on its own. Return an empty array if none
> qualify — that is a good answer, not a failure.

The sitting model (`deepseek/deepseek-v4-flash`) obeys that clause too faithfully. When a new
Note is about the brain-dump app and the shortlist holds five Notes about the brain-dump app,
the model answers "same subject, not enough" and returns nothing. This is finding 08's second
loss point: the dev log shows four passes ending `shortlisted 4–5, linked 0`, and a replay of
`brain-dump-app-feedback`'s real shortlist (exactly the right five siblings at 0.47–0.54
cosine) returned `related: [0]` then `[]`.

## Solution

Replace the clause with a positive criterion, worded as in the bake-off's winning variant:

> Notes are related when they share an app, project, person, place, event, or topic — even
> if they look at it from different angles or at different times. A reader of one would want
> to read the other. Return an empty array only when nothing shares any of those threads.

Keep the surrounding prompt (the JSON-only reply contract, the field description, the
title/summary/content layout) exactly as it is. The instruction to return an empty array when
nothing qualifies stays — what changes is that "nothing qualifies" is now defined by a
positive test the model can apply, not by a warning against the obvious answer.

A rank-then-include variant (ask for the array strongest-first) scored the same in the
bake-off and adds ordering as a bonus; it is recorded here as considered but not taken, to
keep this diff minimal. It can be a later change if Related order ever matters.

## User Stories

1. As the user, I want Notes about the same ongoing subject to link to each other, so that
   the vault accumulates connections the way I actually think.
2. As the user, I want an isolated topic to still get no Related links, so that an empty
   section keeps meaning "nothing connects here".
3. As the user, I want the app to keep using the same models, so that fixing this costs
   nothing per Capture and invalidates nothing.

## Implementation Decisions

- **One prompt edit in `buildRelatedPrompt`.** The clause above is the whole change; the
  reply contract and candidate listing are untouched.
- **No model change.** The bake-off showed the prompt dominates: the same model goes from
  `[]` to all five siblings. Model choice was tested across six flash-tier models and is not
  the lever.
- **No floor or ranking change.** The ranking and the 0.35 floor are healthy — verified
  against the real cache (see the spec addendum).
- **The empty-array permission stays.** The negative control (a Note with no true Related)
  must keep returning an empty list with the new wording; the bake-off confirmed it does
  (18/18 cells).

## Testing Decisions

- **The Seam A suites never assert on prompt text** (spec Testing Decisions) — they must keep
  passing unchanged, proving the orchestration is untouched.
- **The acceptance loop is the replay harness:** `scripts/debug-related-replay.mjs`
  (untracked, `[DEBUG-replay]` marked). After the edit, re-run the judge against the
  `brain-dump-app-feedback` shortlist with the real model: it must return the siblings, not
  `[]`. Record the before/after verdicts in this ticket when done.
- **Negative control:** the same harness on `macbook-keyboard-battery` (or an equivalent
  isolated Note) must still return nothing.
- The untracked harness must stay untracked (it knows the local vault path and uses env
  credentials).

## Out of Scope

- The recovery gap — `recoverPending` writes Notes without ever calling `fillRelated`, so
  offline Captures land with an empty `## Related` regardless of this prompt. That is finding
  08's other loss point and awaits the user's decision (spec addendum).
- Re-organizing existing Notes that already landed with empty Related (the user can trigger
  that per Note; no code needed).
- Embedder model, floor, cap, `embeddableText` — explicitly decided against (spec addendum).
- The oversized-document embed hazard — that is ticket 04.
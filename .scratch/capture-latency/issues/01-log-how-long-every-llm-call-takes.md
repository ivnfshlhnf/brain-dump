**Status:** done

# 01 — Log how long every LLM call takes

**What to build:** Record elapsed milliseconds and the provider's `usage` block on every
chat and embedding log line in `src/lib/llm.ts`. No behaviour change.

**Blocked by:** nothing. Everything else in this thread is blocked by it.

## Problem Statement

The diagnostics log records that a request *began* and never how long it took:

```json
{"at":...,"op":"http","message":"chat request","detail":{"url":"…","model":"…"}}
```

Every latency figure in this thread's spec — 23s to a preview, 15s to a filed Note, 44s for a
re-organize — was reconstructed by subtracting timestamps of *adjacent, unrelated* log lines.
That arithmetic cannot separate a slow model from a slow vault read, and it cannot see
reasoning tokens at all. Ticket 02 turns reasoning off on the strength of a hypothesis; without
this ticket there is no way to confirm it worked beyond "it feels faster".

The provider already returns everything needed. The response body carries a `usage` object
with prompt, completion and — on a reasoning model — reasoning token counts, and it is
currently discarded: `chat()` reads `data.choices?.[0]?.message?.content` and drops the rest.

## Solution

Log a second line when each call *resolves*, carrying the elapsed time and the usage the
provider reported. The existing "request" lines stay — a request that starts and never
resolves is itself the signal for a hang.

For `chat()`: `op: 'http'`, message `chat request resolved`, detail carrying `model`, `ms`,
and the provider's `usage` verbatim (`prompt_tokens`, `completion_tokens`,
`reasoning_tokens` when present, whatever else it sends). For `embed()`: the same shape with
`inputs` alongside.

Failures get the elapsed time too — a request that took 30 seconds to fail is a different
problem from one that failed at once.

Timing is wall-clock around the `fetch` plus `res.json()`, which is what the user waits for.

## User Stories

1. As the maintainer, I want each LLM call's duration in the log, so that a latency question
   is answered by reading rather than by arithmetic on unrelated lines.
2. As the maintainer, I want the provider's token usage recorded, so that reasoning tokens
   are observable and "reasoning is off" is a measurement rather than a belief.
3. As the maintainer, I want a failed call's duration too, so that a slow failure is
   distinguishable from an instant one.
4. As the user, I want none of this to change what the app does, so that instrumentation is
   never a risk to a capture.

## Implementation Decisions

- **A resolve line, not a replacement.** The existing request line stays; a start with no
  matching resolve is how a hang shows up in the durable log.
- **`usage` is logged as the provider sent it**, not mapped onto app-owned fields. The point
  is to see what the provider actually reports, including fields this app does not yet know
  about. A missing `usage` is logged as absent, not as zero.
- **Response typing extends `ChatResponse` and `EmbeddingsResponse`** with an optional
  `usage`; both types exist precisely to make the response contract explicit.
- **Wall-clock around fetch and body parse.** `Date.now()` is enough at this granularity, and
  it matches the `at` field the log already uses.
- **No new log op and no new logger surface.** `op: 'http'` already covers these calls.

## Testing Decisions

- **`tests/llm-provider.test.ts` is the home**, since it already asserts on the request shape
  against a stubbed fetch. Extend it with a collecting `Log` fake.
- **Pin the contract, not the number:** a resolved chat call emits a line whose detail carries
  a numeric `ms` and the `usage` object the stub returned; a failing call emits `ms` too.
- **Assert absence is handled:** a response with no `usage` still logs a resolve line.
- **The whole existing suite must pass unchanged** — this ticket returns the same values as
  before from every function it touches.

## Acceptance (2026-09-02)

Implemented in `src/lib/llm.ts`. Both cloud calls now go through one `timedPost` helper, so
the request / resolved / failed lines cannot drift between chat and embeddings.

- `npx vitest run tests/llm-provider.test.ts` — **16 passed**, six of them new: usage logged
  verbatim, a missing usage block logged as absent rather than as zeros, elapsed `ms` on a
  non-OK response, a rejected fetch logged and rethrown untouched, the embedding call
  recorded with its batch size, and the request line still emitted before the call.
- `npm test` — **273 passed, 10 skipped, 24 files.** `scripts/run-checks.mjs` fails only on
  `check-offline-shell.mjs`, which needs Node ≥ 20.19 against the v18.20.5 in this shell;
  verified pre-existing by stashing the whole change and re-running.
- `svelte-check` — **426 files, 0 errors, 0 warnings.**

One thing the implementation added beyond the ticket as written: a rejected `fetch` is now
caught, logged with its elapsed time and message, and rethrown. It previously left no trace at
this level at all, which is why the `Load failed` in the 2026-09-01 log appears only as a
capture-level failure with no indication of whether the provider was slow or the network was
gone.

**Still outstanding:** the before/after numbers themselves. This ticket makes them
observable; reading them needs a real capture on the phone against a real provider. Record
the `ms` and `usage.reasoning_tokens` for Organize, Match and Related here before ticket 02
changes anything.

## Out of Scope

- Surfacing timings in the app's UI or the Settings diagnostics view. This is for the durable
  log.
- Aggregation, percentiles, or any analysis tooling. Reading the JSONL is enough.
- Timing anything outside `llm.ts` — the vault read inside `findRelated` is inferable from
  the gap between the resolve line before it and the request line after it.

**Status:** done

# 02 — Pin the model and turn reasoning off

**What to build:** Send `reasoning: { enabled: false }` on every chat call, and change the
default `llmModel` to `deepseek/deepseek-v4-flash-0731`.

**Blocked by:** 01 — the before/after must be measured, not felt.

## Problem Statement

`chat()` (`src/lib/llm.ts:277`) sends `model`, `stream`, `response_format`, and `messages`.
It sends nothing about reasoning, so each model's provider default applies. From OpenRouter's
live model metadata:

```
deepseek/deepseek-v4-flash   reasoning: { mandatory: false, default_effort: "high" }
                             supported_efforts: [xhigh, high]
z-ai/glm-5.3-flash           reasoning: { mandatory: true,  default_effort: "max" }
                             supported_efforts: [max, high, low]
```

So every Organize, Match, and Related call has been thinking at high or max effort, on every
capture, since the app was built. The first Organize after Settings switched to
`glm-5.3-flash` on 2026-09-01 took **34.7 seconds**.

Published benchmarks put reasoning's benefit on extraction and classification at roughly
**+4.9% accuracy for ~6.7x output tokens**, and recommend standard models for these task
shapes. All three calls are that shape: Organize extracts and lightly restructures, Match
picks one index or none, Related picks a subset of five indexes. The Organize prompt is
restrictive — *derive only from the Dump, add nothing, invent nothing, a short Dump yields a
short Note* — which is the opposite of what a thinking budget helps with, and a documented
overthinking case: reasoning models generate long chains on easy inputs with no accuracy gain.

Separately, the pinned default is a stale snapshot. `deepseek/deepseek-v4-flash` is the
2026-04-24 build, scoring **42.1** on OpenRouter's intelligence index. The 2026-07-31
snapshot scores **51.8** at the same price.

## Solution

Add `reasoning: { enabled: false }` to the chat request body, and change
`DEFAULT_SETTINGS.llmModel` to `deepseek/deepseek-v4-flash-0731`.

Then verify with ticket 01's instrumentation that `usage.reasoning_tokens` is actually `0`.
`0731` reports `mandatory: false`, so OpenRouter accepts the field — but it lists only
`[max, high, low]` in `supported_efforts`, with no `none`, which is reason enough not to
trust the switch without looking. **If reasoning tokens are still reported, fall back to
`reasoning: { effort: "low" }`** and record the observed numbers in this ticket.

Add a comment beside the model default recording why a dated snapshot is pinned rather than
OpenRouter's `~deepseek/deepseek-v4-flash-latest` alias, next to the existing "Real defaults,
not suggestions" note that already guards this block.

## User Stories

1. As the user, I want the app to stop paying for thinking it does not need, so that
   organizing a thought takes seconds instead of tens of seconds.
2. As the user, I want a default model that is current rather than four months stale, so that
   Notes are organized as well as the same money can buy.
3. As the user, I want to keep setting my own model, so that this default is a starting point
   and not a cage.
4. As the maintainer, I want reasoning explicitly off rather than defaulted off, so that
   changing models cannot silently reintroduce a thinking budget.
5. As the maintainer, I want the model pinned to a dated snapshot, so that a hand-tuned
   faithfulness prompt is never re-tuned by a model that changed underneath it.

## Implementation Decisions

- **`reasoning: { enabled: false }`, not `reasoning_effort: "none"`.** OpenRouter documents
  both; the object form is the one it also documents for `exclude`, and it is what a model
  reporting `mandatory: false` accepts. `exclude: true` is explicitly *not* what is wanted —
  it hides the reasoning from the response while still paying for the tokens.
- **The field goes on all three chat calls**, which means in `chat()` — Organize, Match, and
  Related share it. Splitting reasoning per call type was considered and dropped: it invents
  a settings surface for a hypothesis nothing has tested, and the two mechanical calls are
  the ones that least need it.
- **A pinned snapshot, not the alias.** `~deepseek/deepseek-v4-flash-latest` resolves to 0731
  today, so it buys nothing now, and its failure mode is invisible: the Organize prompt is
  tuned by hand for faithfulness, and a model changing underneath it produces no error, no
  log line, only Notes that gradually get worse. Taking a future snapshot is a Settings edit.
- **`embedderModel` is untouched.** Finding 08's bake-off established there is nothing to
  gain and a re-embed plus floor recalibration to pay.
- **A model that refuses to disable reasoning is a Settings problem, not a code problem.**
  `glm-5.3-flash` cannot turn it off at all; the app sends the field and the provider does
  what it does. No per-model branching.

## Testing Decisions

- **`tests/llm-provider.test.ts` pins the request body**, which already exists for exactly
  this. The reasoning field is a provider contract, not prompt text, so asserting on it does
  not break the "never assert on prompts" rule.
- **Every Seam A suite must pass unchanged.** This ticket changes what is sent, never what is
  parsed or orchestrated.
- **The real acceptance is measured, not asserted:** with ticket 01 in place, capture on the
  phone and record from the durable log — before and after — the resolved `ms` for the
  Organize, Match and Related calls, and `usage.reasoning_tokens` for each. Write both sets of
  numbers into this ticket.
- **A quality check, not a test:** re-run `scripts/debug-related-replay.mjs` on the finding-08
  cases with reasoning off. The judge must still return the siblings and still return nothing
  on the negative control. If it degrades, record it — that is a prompt finding, not a reason
  to restore the thinking budget.

## Out of Scope

- Per-call-type reasoning settings, or exposing reasoning in Settings.
- `max_tokens`, `temperature`, or a request timeout. Real gaps, but each is its own change
  with its own failure modes.
- Changing `embedderModel`.
- Prompt work on Organize. If output degrades, record the finding.

## Comments

**2026-09-02 — shipped** (llm.ts `chat()`, types.ts default). The reasoning field rides on
every chat call (Organize, Match, Related, and the Answerer share `chat()`), and
`DEFAULT_SETTINGS.llmModel` is now `deepseek/deepseek-v4-flash-0731` with the dated-snapshot
comment beside the "Real defaults, not suggestions" note.

**Judge quality check (the ticket's one non-test acceptance), run live with reasoning off:**
three runs of the finding-08 bake-off cases through the replay shortlist against `0731`
with `reasoning: { enabled: false }`, verifying `reasoning_tokens` is genuinely 0 on every
call —

- **macbook-keyboard-battery (negative control): `[]` in all three runs.** The loosened
  prompt still does not open junk links.
- **espresso: `[0,1]`, `[1]`, `[0,1]`** — the two true siblings most runs, one dropped once.
- **app-feedback: `[1,3,4]`, `[0,1,2,3,4]`, `[1,2,0,3,4]`** — *unstable.* The bake-off with
  reasoning at default effort returned all five siblings; reasoning-off returns a varying
  subset (one run only `[1]`). The judge is the one call of the three whose task shape is
  judgement rather than extraction, and it is the one that got noisier.

**Recorded as a prompt finding, per the ticket's own rule — not a reason to restore the
thinking budget.** Latency is the point of this thread, and the judge runs behind the
preview where the wait is free (ticket 04). If Related precision visibly degrades in
dogfooding, the floor is `effort: "low"` on the Relater only — a per-call split, which this
ticket deliberately declined, would become warranted then.

**Still outstanding (same as ticket 01):** the *after* numbers from a phone capture —
resolved `ms` for Organize/Match/Related and `completion_tokens_details.reasoning_tokens`
per call — to be recorded here at the next dogfooding session. The replay ranking is
unchanged (57/63 cache hits, same top-5).

**2026-09-02 — desktop "after" numbers recorded** (the phone capture is still outstanding,
but the gate question for ticket 07 did not need the phone — generation time dominates, not
the phone network). Seven live Organize calls from the desktop with `reasoning: { enabled:
false }` against `deepseek/deepseek-v4-flash-0731`, ~230–260 completion tokens each, every
call reporting `reasoning_tokens: 0`: **2.9s, 3.1s, 9.6s, 11.2s, 11.3s, 11.7s, 16.0s**.
Bimodal — fast calls exist, but the dominant mode sits at or past the 10-second attention
limit, at ~20 tok/s from the provider. Reasoning-off removed the *thinking* part of the
wait; the generation part remains, which is why ticket 07 built the streamed Organize.

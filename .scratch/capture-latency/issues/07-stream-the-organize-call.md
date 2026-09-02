**Status:** done

## Comments

2026-09-02 — **the gate resolved in favour of building, but not for the reason the ticket
expected.** With reasoning verified off (`reasoning_tokens: 0` on every call), seven live
Organize calls from the desktop measured **2.9s, 3.1s, 9.6s, 11.2s, 11.3s, 11.7s, 16.0s** on
~230–260 completion tokens — roughly 20 tok/s from the provider, and bimodal. The dominant
mode sits at or past the 10-second attention limit, so the wait the ticket guards against is
still real; what reasoning-off removed was only the *thinking* part of the wait. (Ticket 02's
phone capture remains outstanding for the ticket-02 record; these desktop numbers are what
the gate needed — generation time, not phone network, dominates.)

Built as specified: `chatStream` in `llm.ts` (`stream: true`, `stream_options:
{ include_usage: true }`, JSON mode and reasoning-off unchanged), and `createOrganizer`
takes an optional `onToken` third argument — the Organizer interface is untouched, every
existing fake keeps working, and callers without a watcher (recovery, re-organize) keep the
non-streamed request, pinned by test. The capture sheet's organizer passes a callback that
flips the Capture button from "Capturing…" to "Writing…" when the first delta lands; the
preview still renders only when the whole reply has arrived and parsed. Every stream failure
is a failed call with the same three-line log contract — verified: mid-stream error, a
stream that ends without `[DONE]`, and a non-OK status each reject with a `failed` line and
no resolved line, so partial output is never parsed.

Live-verified against OpenRouter: 141 deltas, full usage on the final chunk
(`reasoning_tokens: 0`), same OrganizeOutput as the non-streamed shape. The check harness
gained `fulfillChat` (SSE when the request streams, JSON otherwise) used by the
committed-sheet and recovery-refresh checks.

Verified: 293 tests pass (5 new at the llm seam), svelte-check clean, all 9 browser checks
pass, tokens clean.

# 07 — Stream the Organize call for liveness

**What to build:** `stream: true` on the Organize call, with a token callback the capture
sheet uses to show the model is alive. The reply is still consumed whole.

**Blocked by:** 02, **and gated on its numbers.** Build this only if the measured Organize
duration after reasoning is off is still long enough to need it.

## Problem Statement

`chat()` sends `stream: false` (`src/lib/llm.ts:283`), so nothing exists on screen until the
whole reply arrives. Organize is the first call on the capture path and the only one the user
waits on before there is anything to read — logged at 15.2s and 14.4s with reasoning at high
effort.

Nielsen's limits put 1 second as the boundary of unbroken thought and 10 seconds as the limit
of held attention; past 10 seconds a progress indicator stops being polite and becomes
required. No model reaches 1 second on a reply of this size, which is why the standard answer
is not "be faster" but "show something within a second."

## Solution

Stream the Organize call and surface arrival, not content: the sheet shows that the model is
producing output. Tokens accumulate into the same string `parseOrganizeOutput` already
receives, so parsing, validation and every downstream type are untouched.

**No incremental JSON parsing.** Rendering the title as it arrives, then the summary, then the
body, is real complexity — a partial-JSON parser and a half-built `OrganizeOutput` flowing
through the app — for a preview the user is about to read whole. The value here is entirely in
the first hundred milliseconds: proof the app is working.

**This ticket is gated, deliberately.** The thread's rule is measure first. If ticket 02's
numbers put Organize in the low single digits, this is complexity bought for a wait that no
longer exists, and the honest outcome is to close it unbuilt with the numbers recorded. If
Organize is still near or past 10 seconds, build it.

## User Stories

1. As the user, I want to see that the app is working within a moment of pressing Capture, so
   that a slow organize is never indistinguishable from a hang.
2. As the user, I want the organized Note to be exactly what it would have been, so that
   showing progress does not change the result.
3. As the maintainer, I want streaming confined to one call, so that the other three keep the
   simplest possible request shape.

## Implementation Decisions

- **Organize only.** Match and Related resolve behind a preview the user is already reading;
  streaming them would show progress on work nobody is waiting for.
- **The streamed reply is accumulated and parsed exactly as today.** `parseOrganizeOutput` and
  `response_format: { type: 'json_object' }` are unchanged; only the transport differs.
- **A token callback on the seam, not a new interface.** `Organizer` keeps its shape; the
  callback is an optional dependency, so every existing fake keeps working untouched.
- **A stream that fails mid-reply is a failed call**, handled exactly as a failed request is
  today — the Dump is Pending and recovery has it. Partial output is never parsed.
- **Liveness, not content.** What the sheet shows is that output is arriving; deciding what
  that looks like is a design question for the implementation, not a spec decision.

## Testing Decisions

- **`tests/llm-provider.test.ts` is the home for the transport change**, against a stubbed
  streaming response: the accumulated reply parses to the same `OrganizeOutput` a non-streamed
  reply of the same content produces. That equivalence is the whole contract.
- **A stream that errors mid-reply surfaces as a rejected call**, and no partial parse is
  attempted.
- **Every Seam A suite must pass unchanged** — fakes do not stream, and the callback is
  optional, so orchestration is untouched by construction.

## Out of Scope

- Incremental JSON parsing or progressive rendering of Note fields.
- Streaming Match, Related, or the Answerer.
- Streaming the Retrieve answer, which is a different surface with a different argument.

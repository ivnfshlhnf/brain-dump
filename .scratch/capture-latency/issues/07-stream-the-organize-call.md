**Status:** blocked — decide from ticket 02's measurements

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

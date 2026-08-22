**Status:** ready-for-agent

# 01 — Cover the operation layer's instrumentation, and move validation out of the view

**What to build:** Tests, at Seam A, for the diagnostic events the operation layer already
emits — and a move of the provider-URL validation rule out of the view component so it is
reachable by a test at all. No new behaviour; no new seam.

**Blocked by:** nothing.

## Problem Statement

Two pieces of the diagnostics work shipped without test coverage, and both are the kind that
fail silently.

The operation layer emits events on capture, on queue-after-failure, and on every drain
attempt. Those events are the record relied on when something breaks against a real vault —
they are the reason a future failure will be diagnosable at all. Nothing asserts that any of
them are emitted. If one were dropped in a refactor, every test would stay green and the loss
would only be discovered during the next incident, which is exactly the moment the record
matters.

The provider-URL validation rule lives inside the view component. It is real behaviour — it
decides whether configuration is accepted — but it sits where no test can reach it, and it
contradicts this repo's own principle that the view is a thin shell over the operation layer.
It is currently trusted because it was written carefully, not because it is pinned.

## Solution

Assert the emitted events by driving the existing operations with a recording log, at Seam A,
alongside the tests that already drive those same operations. Move the validation rule beside
the other configuration operations and pin its cases directly.

Nothing about the app's behaviour changes. This closes the gap between what the diagnostics
work claims and what is actually guaranteed.

## User Stories

1. As the maintainer, I want the capture events asserted, so that the record of a capture
   cannot silently stop being written.
2. As the maintainer, I want the queue-after-failure event asserted, so that the distinction
   between "offline" and "failed while online" cannot regress into telling the user something
   untrue.
3. As the maintainer, I want each drain attempt's events asserted, so that a repeating failure
   stays visible as a repeating record rather than a silent spin.
4. As the maintainer, I want the drain's success events asserted, so that a Dump becoming a
   Note is traceable after the fact.
5. As the maintainer, I want the validation rule to live where a test can reach it, so that it
   is guaranteed rather than merely written carefully.
6. As the maintainer, I want each rejection case pinned separately, so that a change to one
   does not quietly weaken another.
7. As the maintainer, I want the view to only render the validation result, so that the codebase
   keeps its thin-view property.
8. As the maintainer, I want no new test seam introduced, so that this feature stays at the
   seam the rest of the codebase uses.

## Implementation Decisions

- **Assert at Seam A, with a recording log.** The logging seam is already an injected optional
  dependency, so a test passes a recording implementation into the operations it already drives
  and asserts on what was observed. No production code changes for this half.
- **Assert on operation name, level, and the identifying detail** — not on message wording.
  Message text is presentation and will be reworded; the operation name, whether it was an
  error, and the identifier tying an event to a Dump are the contract.
- **Move validation beside the other configuration operations**, returning a description of the
  problem or nothing. The view calls it and renders the result; the rule itself stops being
  view code.
- **No change to what is emitted or when.** This ticket pins current behaviour; adding events is
  a separate concern.

## Testing Decisions

- Extend the existing Seam A suites rather than adding a new file per concern: the drain events
  belong with the outbox tests that already drive drain against controlled failures, and the
  capture events belong with the operations tests that already drive capture.
- Simulate failure the way those suites already do — by making an injected dependency fail —
  never by reaching into a module.
- Validation cases to pin: blank, unparseable, non-http protocol, and a valid value.
- Prior art: the outbox suite for driving drain against a failing dependency; the operations
  suite for capture; the health suite for asserting a structured result.

## Out of Scope

- Adding new diagnostic events, or changing existing ones.
- Testing the development file sink or its middleware — build tooling, verified by hand.
- Persisting the log, log levels, or anything else listed out of scope in the feature spec.

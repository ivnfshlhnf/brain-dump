**Status:** ready-for-agent

# 02 — Cover the operation layer's instrumentation

**What to build:** Tests, at Seam A, for the diagnostic events the operation layer already
emits. No new behaviour, no production code changes, no new seam.

**Blocked by:** nothing.

**History:** this was originally the second half of ticket 01, which also covered moving the
provider-URL validation rule out of the view. That half was done first and 01 now covers it
alone; this ticket carries the deferred test coverage so each has an honest status.

## Problem Statement

The operation layer emits events on capture, on queue-after-failure, and on every drain
attempt. Those events are the record relied on when something breaks against a real vault —
they are the reason a future failure will be diagnosable at all. Nothing asserts that any of
them are emitted. If one were dropped in a refactor, every test would stay green and the loss
would only be discovered during the next incident, which is exactly the moment the record
matters.

## Solution

Assert the emitted events by driving the existing operations with a recording log, at Seam A,
alongside the tests that already drive those same operations.

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
5. As the maintainer, I want no new test seam introduced, so that this feature stays at the
   seam the rest of the codebase uses.

## Implementation Decisions

- **Assert at Seam A, with a recording log.** The logging seam is already an injected optional
  dependency, so a test passes a recording implementation into the operations it already drives
  and asserts on what was observed. No production code changes at all.
- **Assert on operation name, level, and the identifying detail** — not on message wording.
  Message text is presentation and will be reworded; the operation name, whether it was an
  error, and the identifier tying an event to a Dump are the contract.
- **No change to what is emitted or when.** This ticket pins current behaviour; adding events is
  a separate concern.

## Testing Decisions

- Extend the existing Seam A suites rather than adding a new file per concern: the drain events
  belong with the outbox tests that already drive drain against controlled failures, and the
  capture events belong with the operations tests that already drive capture.
- Simulate failure the way those suites already do — by making an injected dependency fail —
  never by reaching into a module.
- Prior art: the outbox suite for driving drain against a failing dependency; the operations
  suite for capture.

## Out of Scope

- Adding new diagnostic events, or changing existing ones.
- Testing the development file sink or its middleware — build tooling, verified by hand.
- Persisting the log, log levels, or anything else listed out of scope in the feature spec.

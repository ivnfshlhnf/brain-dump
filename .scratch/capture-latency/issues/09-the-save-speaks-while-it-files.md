**Status:** in progress

# 09 — The save speaks while it files

**What to build:** a loading state on the save, an in-flight guard so one save cannot run
twice, and a log line for a failed save.

**Blocked by:** nothing — a finding from the phone log and the user's own hand on it.

## Problem Statement

Three findings from the 2026-09-02 phone log, one capture.

**The save has no liveness.** The user says it plainly: *"the save button doesnt show any
loading state or progress."* Confirming an Append starts the longest single wait on the
capture path — merge, a wholesale re-organize (measured at **7.4s** and **7.0s** on the
phone), the write, and the save-time Related pass — and for all of it the Append button sits
exactly as it was. Capture got its signal in ticket 07 (`Capturing…` → `Writing…`); the save
path — the other wait the user actively triggers — did not. Nielsen's rule cuts both ways:
the preview must show something within a second, and so must the button the user just
pressed.

**A save can appear to do nothing, and then run twice.** The log shows the same merged Dump
re-organized twice (`prompt_tokens: 287` in both), 22 seconds apart. The first theory — a
double-tap racing `saveAndFinalize`'s `session.saved` guard — did not survive contact with
the code: every save path (Append, Save now, Cmd+Enter, the timer, close) goes through the
autosaver, whose `run` already coalesces overlapping saves (`autosave.ts:29`: *"Coalesce
overlapping saves: the final Organize must run once over the full Dump, not re-enter while
a save is already in flight"*). A probe with the would-be guard removed still saw one
re-organize. The two runs are best read as a **save that failed after its re-organize,
invisible in the log, followed by a manual Save now** 22 seconds later — which makes the
missing loading state and the missing failure line the same bug seen from two sides: the
user could not tell the save was running, and the log cannot tell anyone it failed.

**A failed save is invisible in the log.** `recordFailure` (`operations.ts:1559`) writes the
Pending record and logs nothing, so a save that fails after its re-organize leaves the
durable log with nothing but a gap. Every other path names its failure — `capture failed
online`, `chat request failed` — but the save, the one failure the user is actually
watching, is the one the log cannot show. This analysis started with that gap.

## Solution

1. **Liveness.** While a finalize is in flight, the primary action reads **Filing…** (and is
   disabled) — the Capture button's precedent, extended to the save: a label swap that says
   the tap landed and the work is running. Liveness, not content; the committed sheet
   (ticket 06) remains the only "done" signal.
2. **Single flight stays the autosaver's job.** The autosaver's `run` already coalesces
   overlapping saves, and it is the only door to `saveAndFinalize`. A sheet-level flight
   guard was tried, falsified by the probe above, and removed — one serializer, stated in
   one place.
3. **The failure line.** `finalizeCapture`'s catch logs `the save failed — the Dump stays
   Pending for retry` (level error, with the dumpId and the error), so the durable log shows
   what the user saw — including, now, which of the log's two re-organizes was the retry.

## User Stories

1. As the user, I want the button I pressed to say it is working, so that a 7-second
   re-organize is never indistinguishable from a dead tap.
2. As the user, I cannot file the same capture twice by pressing twice, so that impatience
   costs nothing.
3. As the maintainer, I want a failed save in the durable log, so that the next latency or
   failure analysis does not start from a silent gap.

## Implementation Decisions

- **A label swap, not a spinner.** Same treatment as ticket 07's `Writing…`: the button's
  own text carries the state, no new chrome. The word is *Filing* — the app's own verb for
  what a save does. The button is disabled for the flight, matching the Capture button's
  `disabled={busy}` pattern.
- **No new serializer.** The probe killed the sheet-level flight flag; the autosaver's
  coalescing is the single-flight property, kept where it was.
- **The failure log rides the existing `log` dep** — `finalizeCapture` already receives it;
  nothing new is threaded.

## Testing Decisions

- **Seam A:** a finalize whose Note write fails returns `ok: false` **and** the log carries
  the failure line with the dumpId — the property this log could not show.
- **A new browser check drives the append path end to end**, which no check had done: the
  first capture files itself (real Note + real Dump written by the app, no hand-built
  frontmatter), the second capture's Match mock answers `append`, and the check asserts the
  button shows Filing… the moment it is pressed, that a second flush during the flight is
  coalesced by the autosaver, and that the mock saw **exactly one** re-organize call.
- **Every existing suite passes unchanged** — the operation layer's behaviour is untouched
  except for one log line.

## Out of Scope

- What the failure looks like on screen beyond today's Held state and status line.
- A retry affordance beyond the existing Save now.
- Streaming or progress within the re-organize itself — the whole flight is one label.
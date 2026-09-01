**Status:** parked (2026-09-01) — observed on the phone, deliberately not driving past ticket 03's
verification to fix it. Visit when it bites in practice.

# 04 — Capture lingers ~35s when the network claims online but is dead

**Observed (ticket 03, re-verification of item 2, dump `faf0fefe`, 2026-09-01):** airplane
mode came on a beat after the capture press. The phone still reported online, so the capture
took the honest online path — enrolled the Dump `in-flight`, then waited **34.7s** for the
OpenRouter call to fail with `Load failed` before the sheet closed and the Pending receipt
showed. On reconnect, recovery filed the Note normally (`organized:1`). Everything was
correct; only the wait was wrong-feeling.

**Why it happens:** the capture path has no early-bail. A fetch that hangs (no RST, no
DNS error — a dead radio that still claims online) costs the full request timeout before
the Pending enrollment, which already happened at `in-flight` time, becomes visible as
the receipt. The engine was never at risk; the UX paid the whole timeout.

**Candidate fix shape (to be validated against the code, not assumed):**
- The receipt could show as soon as the first request fails — `Load failed` arrives in
  milliseconds when the radio is honest; the 35s came from one specific hang. Confirm
  which wait actually costs the 34.7s (the log's `capture started` → `capture failed
  online` gap) before choosing.
- Possible seam: a timeout/race around the online attempt, or surfacing the already-enrolled
  Pending card immediately and letting the online attempt's failure be a background
  transition. Any early-bail must not break the live-capture path (a working LLM call is
  the common case and must keep its current latency).

**Evidence:** `logs/brain-dump-log-2026-09-01.jsonl.ndjson` — `capture started`
04:51:15.988 → `Dump enrolled as Pending (in-flight)` 04:51:16.006 → `capture failed
online — Dump left Pending for retry` 04:51:50.656 (`Load failed`) → `recovery started
{due:1}` 04:53:02.998 → `Note written` 04:53:44.070. The exported-log evidence path
(ticket 02) is how this was found without touching the phone.

**Notes:**
- Not a regression from the Host work — the path predates it; the offline verification is
  just the first time it was watched with a log running.
- Related parked edge, deliberately separate: the `recovering` latch in App.svelte can
  swallow an onOnline recovery if the retry-timer's run started offline
  (`if (recovering) return;` guard). Same neighborhood (recovery triggers), different
  bug; ticket it separately if it ever shows.
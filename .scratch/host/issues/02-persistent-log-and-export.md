**Status:** done

# 02 — Persistent log and JSONL export

**What to build:** The log ring buffer survives restarts, and Settings gains Export — a
download in the dev log's one-JSON-object-per-line format — alongside a Clear.

**Blocked by:** nothing (independent of 01; runs on any origin including the dev server).

## Problem Statement

The in-memory ring buffer dies with the page. A phone-only failure that ends a session takes
its own evidence with it — the reload that killed the failure erased the record of it. In
dev the jsonl sink writes a durable file, but a production build ships no middleware, so the
diagnostic path that found findings 02–06 exists only on the dev origin.

## What to build

- **Persistence under the logging seam.** The buffer stays the working set (its
  human-readable `format()` and the Copy button unchanged); a persistence layer retains
  events across restarts — loaded on boot, appended as events arrive — with eviction at
  ~200 events, oldest first. Storage is IndexedDB, consistent with the Pending store.
- **Export.** A Settings action that downloads the retained events as one JSON object per
  line — the raw event object, not the human-readable `format()` lines. Byte-compatible
  with what the dev sink writes for the same events, by construction.
- **Clear.** Empties both the in-memory and the persisted log.
- **Settings sheet wiring.** Export and Clear sit next to the existing Copy button; the
  sheet's vocabulary follows DESIGN.md as the other actions do.

## Tests

- At the logging seam (prior art: `tests/logger.test.ts`): events survive a simulated
  restart; exported output is one JSON object per line matching the dev sink's
  serialization for the same events; eviction keeps the newest; Clear empties everything;
  a failing persistence attempt never breaks logging.
- Settings-sheet behavior lands in the `scripts/check-*.mjs` Playwright family if the
  surface warrants it; the sheet's structure is shared with existing guarded actions.

## Notes

- Export exports *events*; Copy copies the readable text. Two artifacts, both legitimate,
  deliberately different formats — the decision is in the host spec.
- Events never carry Dump or Note content (paths, lengths, outcomes only — the existing
  logger's contract), so an exported log is safe to paste into a conversation.
- iOS may have quirks around downloading a blob from a standalone PWA; if Export on the
  phone proves hostile, the fallback is Copy-from-Settings of the JSONL text — decide in
  ticket 03 against the real device, not speculatively.

  **Decided on the real device (ticket 03, 2026-09-01): no fallback needed.** The blob
  download works from the standalone PWA on iOS — the file landed as
  `brain-dump-log-2026-09-01.jsonl.ndjson` and byte-compared against the dev format
  (81 lines, one JSON object per line, same op vocabulary). Copy stays as the readable
  alternative it was designed to be, not a fallback.
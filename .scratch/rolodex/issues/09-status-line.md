# 09 — The status line

**What to build:** One thin live strip on the grid — the app's single cross-cutting voice. It
carries only what belongs to no card: that a capture landed, that the connection went or came
back, and that a setting was rejected.

Queued and failed are deliberately absent. They now live on their own cards, and the rule this
strip is written under is that state belongs on the thing it is about.

It is fed by a callback on the operation layer rather than an event bus, which keeps the source
assertable at the existing test seam and keeps the strip small.

**Blocked by:** 02

**Status:** done

- [x] One live strip sits on the grid and announces politely, without interrupting a screen reader
- [x] It carries exactly three kinds of message: capture confirmed, connection lost or restored, and a settings rejection
- [x] Queued and failed states never appear on it
- [x] The capture confirmation fades on its own; the other two hold until cleared or resolved
- [x] Every message can be cleared immediately, including one the user would rather deal with later
- [x] Every message carries a word, never colour alone
- [x] It is fed by an operation-layer callback, not an event bus, and the source is assertable at the operation-layer seam
- [x] It does not appear inside any sheet

## Comments

- **The three kinds, and only the three.** `StatusKind` is a closed four-member union
  (`capture-confirmed | connection-lost | connection-restored | config-rejected`), counting both
  directions of connection as the one "connection" kind the spec names. Queued and failed are
  structurally impossible on the strip: nothing else calls `setStatus`, and the producers only
  build these four kinds. The view renders `{strip.message}` — it composes no text.

- **The seam (criterion 7).** A new `src/lib/status.ts` mirrors the existing `Log`/`noopLog`
  logger seam: an `OnStatus` callback on `PendingCaptureDeps`, defaulting to `noopStatus`, that
  `captureThought` calls itself in its two pending branches (offline, capture-failed). The source
  is the operation layer, not an event bus. `tests/status.test.ts` asserts the three pure
  producers; `tests/pending.test.ts` asserts `captureThought` emits via `onStatus` (array-push,
  the same pattern as the existing `onPending` assertion) and that a session-path capture emits
  nothing.

- **Connection source.** Connection comes from `navigator.onLine` browser events (`online`/
  `offline`), tracked with `wasOnline` so `connectionTransition` can tell a real change from a
  no-op — the strip is not a heartbeat. The message *text* is the operation-layer pure function
  `connectionTransition`; the browser-event wiring stays in the view. Both listeners share an
  `applyConnection(next)` helper.

- **Fade vs hold (criterion 4).** `capture-confirmed` clears itself after 6 s (a `setTimeout`
  stored in `stripTimer`, cleared on dismiss/new message) — the thought is safe and the Pending
  card is already the receipt. `connection-*` and `config-rejected` hold. A `connection-restored`
  replaces a held `connection-lost`; a successful `saveConfig` clears a held `config-rejected`.

- **Clearable immediately (criterion 5).** A `Dismiss` control on the strip calls `clearStrip` →
  `setStatus(null)` for every kind, including one the user would rather deal with later
  (`config-rejected`, `connection-lost`).

- **Word, never colour alone (criterion 6).** The message text is the signal. A coloured left
  border (`.status-strip--alert`, the `--alarm` hue) accents `connection-lost` and
  `config-rejected` only — supplementary, never the sole signal. Verified by the `vision` subagent
  across desktop/phone × light/dark.

- **Not inside any sheet (criterion 8).** The cross-cutting strip is gated `{#if strip && !sheet}`
  — it never renders while a sheet is open. Per-surface local `status` lines inside the Capture,
  Note, Ask, and Settings sheets are intentionally kept (a confirmed scope decision): criterion 8
  applies to the cross-cutting strip only; each sheet's local feedback is "the thing it is about."

- **The recovery banner stays.** The pre-existing recovery banner (stranded/recovering/retrying/
  offline/inFlight counts + Retry) is a *recovery* affordance for the Pending/Stranded Dumps
  themselves — recovery state, which belongs to those Dumps, not to the cross-cutting strip. It is
  distinct from the new strip and remains on the grid. (A prior draft of the banner's comment
  claimed ticket 09 would replace it; the comment now describes the truth — ticket 09 added the
  separate strip for the card-less kinds, this banner stays the recovery voice.)

## Verification

- `npm run typecheck` (svelte-check) — 0 errors / 0 warnings across 417 files.
- `npx vitest run` — 230 passed / 10 skipped (22 files). The 10 skips are the live-service smoke
  tests (LLM, livesync, organize-faithfulness). New: `tests/status.test.ts` (10 tests) and 3
  added tests in `tests/pending.test.ts` ("the strip is fed by the operation layer, not the view").
- `node scripts/shot-status.mjs` — 16 screenshots (4 states × desktop/phone × light/dark). Every
  capture asserted `sheetOpen: false` (strip on the grid, not in a sheet), `dismiss: true`
  (clearable), non-empty `text` (word, not colour alone), and `alert` true only for
  connection-lost / config-rejected. Verified by the `vision` subagent: text carries the meaning
  in every variant, the Dismiss control is visible, colour is supplementary, and the phone layout
  wraps without truncating.

## Code review

Two-axis review (Standards: Fowler smell baseline, no repo standards doc; Spec: this issue).
Standards — two judgement-call smells, both fixed: the duplicated `online`/`offline` handler body
collapsed into a shared `applyConnection(next)` helper, and the inline `onStatus` shape in
`tests/pending.test.ts` replaced with an `OnStatus` import; plus a missing trailing newline on
`status.ts` restored. A third noted smell (three scattered switches on `strip.kind`) was
deliberately not extracted — a `Record<StatusKind, …>` table for four kinds across three sites is
speculative generality, and the reviewer called it acceptable as-is. Spec — one finding: a stale
comment on the recovery banner claimed ticket 09 replaces it; resolved per the user's decision to
keep the banner, by rewriting the comment to describe the banner's actual role alongside the new
strip.
// The status line seam — the app's single cross-cutting voice, fed by the operation layer.
//
// The grid carries one thin live strip that announces only what belongs to no card: that a
// capture landed, that the connection went or came back, and that a setting was rejected.
// Queued and failed states are deliberately absent from it — they live on their own cards, and
// the rule this strip is written under is that state belongs on the thing it is about.
//
// This module is the source of every strip message, so the source is assertable at the existing
// test seam: tests call the producers directly and assert what the strip would say. It is the
// same shape as the `Log` seam in logger.ts — a callback the operation layer calls, with a
// `noopStatus` default so adding a status emission never forces every caller to supply one.

import type { NoPreviewReason } from './operations';
import type { ProviderUrlProblem } from './config';

/** The three (well, four — connection has two directions) kinds of message the strip carries. */
export type StatusKind =
  | 'capture-confirmed'
  | 'connection-lost'
  | 'connection-restored'
  | 'config-rejected';

/** One strip message. The `message` is the word the strip shows — colour is never the sole
 *  signal (acceptance #6). */
export interface StatusMessage {
  kind: StatusKind;
  message: string;
}

/** The callback the operation layer calls to hand a message to the strip. Parallel to `Log`. */
export type OnStatus = (message: StatusMessage) => void;

/** A status callback that discards everything — the default wherever `onStatus` is optional. */
export const noopStatus: OnStatus = () => {};

/** The message for a capture that landed with no card to show it — offline, or failed while
 *  online. The human text is built here, in the operation layer, not in the view: the view only
 *  renders it. Mirrors the framing the view used to assemble (`Captured — …[. Capture failed: …]`). */
export function captureConfirmedMessage(
  reason: NoPreviewReason,
  message: string,
  error?: Error,
): StatusMessage {
  if (reason === 'offline') return { kind: 'capture-confirmed', message: `Captured — ${message}.` };
  const why = error ? ` Capture failed: ${error.message}` : '';
  return { kind: 'capture-confirmed', message: `Captured — ${message}.${why}` };
}

/** The message for a connectivity transition, or `null` when nothing changed. The app's
 *  "connection" is `navigator.onLine` — the live, automatic connectivity model capture already
 *  depends on — so "lost" is going offline and "restored" is coming back. No transition (online
 *  → online, offline → offline) emits nothing: the strip is not a heartbeat. */
export function connectionTransition(prev: boolean, next: boolean): StatusMessage | null {
  if (prev === next) return null;
  if (next) return { kind: 'connection-restored', message: "You're back online." };
  return {
    kind: 'connection-lost',
    message: "You're offline — captures still save, and organize when you're back.",
  };
}

/** The message for a setting the user tried to save that the config rules rejected. The
 *  `ProviderUrlProblem` already carries the human `message` (config.ts); this only lifts it
 *  onto the strip's kind. */
export function configRejectedMessage(problem: ProviderUrlProblem): StatusMessage {
  return { kind: 'config-rejected', message: problem.message };
}

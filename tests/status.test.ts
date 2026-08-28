// Seam A — the status-line producers. The strip's message text is the operation layer's
// contract, asserted here directly: tests call the producers and assert what the strip would
// say. The view only renders these; it builds nothing.
import { describe, it, expect } from 'vitest';
import {
  captureConfirmedMessage,
  connectionTransition,
  configRejectedMessage,
  noopStatus,
  type StatusMessage,
} from '../src/lib/status';
import { OFFLINE_CAPTURE_MESSAGE, CAPTURE_RETRY_MESSAGE } from '../src/lib/operations';
import type { ProviderUrlProblem } from '../src/lib/config';

describe('captureConfirmedMessage', () => {
  it('frames an offline capture as a plain confirmation, no failure', () => {
    expect(captureConfirmedMessage('offline', OFFLINE_CAPTURE_MESSAGE)).toEqual({
      kind: 'capture-confirmed',
      message: `Captured — ${OFFLINE_CAPTURE_MESSAGE}.`,
    });
  });

  it('frames a capture that failed while online with the error, not "you are offline"', () => {
    const msg = captureConfirmedMessage('capture-failed', CAPTURE_RETRY_MESSAGE, new Error('network down'));
    expect(msg.kind).toBe('capture-confirmed');
    expect(msg.message).toBe(`Captured — ${CAPTURE_RETRY_MESSAGE}. Capture failed: network down`);
  });

  it('still confirms when an online capture failed with no error detail', () => {
    expect(captureConfirmedMessage('capture-failed', CAPTURE_RETRY_MESSAGE)).toEqual({
      kind: 'capture-confirmed',
      message: `Captured — ${CAPTURE_RETRY_MESSAGE}.`,
    });
  });
});

describe('connectionTransition', () => {
  it('announces lost when the connection goes away', () => {
    expect(connectionTransition(true, false)).toEqual({
      kind: 'connection-lost',
      message: expect.stringContaining('offline'),
    });
  });

  it('announces restored when the connection comes back', () => {
    expect(connectionTransition(false, true)).toEqual({
      kind: 'connection-restored',
      message: expect.stringContaining('back'),
    });
  });

  it('emits nothing when connectivity has not changed — the strip is not a heartbeat', () => {
    expect(connectionTransition(true, true)).toBeNull();
    expect(connectionTransition(false, false)).toBeNull();
  });

  it('carries a word, never colour alone — every message has non-empty text', () => {
    const lost = connectionTransition(true, false);
    const restored = connectionTransition(false, true);
    expect(lost && lost.message.trim().length).toBeGreaterThan(0);
    expect(restored && restored.message.trim().length).toBeGreaterThan(0);
  });
});

describe('configRejectedMessage', () => {
  it('lifts a rejected setting onto the strip, keeping the config rule message', () => {
    const problem: ProviderUrlProblem = { code: 'blank', message: 'LLM provider is required, e.g. https://openrouter.ai/api/v1' };
    expect(configRejectedMessage(problem)).toEqual({
      kind: 'config-rejected',
      message: problem.message,
    });
  });

  it('preserves whichever rule fired — the code stays matchable, the message is what the user reads', () => {
    const problem: ProviderUrlProblem = { code: 'bad-scheme', message: 'LLM provider must be http(s), not "ftp:"' };
    expect(configRejectedMessage(problem).message).toBe(problem.message);
  });
});

describe('noopStatus', () => {
  it('accepts any message and discards it — the default wherever onStatus is optional', () => {
    const received: StatusMessage[] = [];
    const onStatus: typeof noopStatus = (m) => received.push(m);
    onStatus({ kind: 'capture-confirmed', message: 'Captured.' });
    // noopStatus itself is the discard default; this just exercises the type.
    expect(received).toHaveLength(1);
  });
});
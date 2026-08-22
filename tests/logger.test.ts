// The diagnostics log (src/lib/logger.ts) and the thing it exists to make obvious.
//
// Today's dogfooding bug: `llmProvider` was blank, so `${base}/chat/completions` resolved
// against the app's own origin and every Organize 404'd against the dev server. The app
// reported a truthful but useless "LLM request failed: 404 Not Found". These tests pin the
// behaviour that turns that into an actionable line — the *resolved* URL in the log and in
// the thrown error — plus the ring buffer's own contract.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLog, formatEvent, noopLog, type LogEvent } from '../src/lib/logger';
import { createOrganizer, createEmbedder } from '../src/lib/llm';
import { DEFAULT_SETTINGS, type Settings } from '../src/lib/types';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('the diagnostics log', () => {
  it('records events in order with a timestamp and a default level', () => {
    let t = 1000;
    const store = createLog({ now: () => (t += 10) });

    store.log({ op: 'capture', message: 'first' });
    store.log({ level: 'error', op: 'drain', message: 'second', detail: { dumpId: 'abc' } });

    const events = store.events();
    expect(events.map((e) => e.message)).toEqual(['first', 'second']);
    expect(events[0]).toMatchObject({ at: 1010, level: 'info', op: 'capture' });
    expect(events[1]).toMatchObject({ at: 1020, level: 'error', detail: { dumpId: 'abc' } });
  });

  it('bounds the buffer, keeping the most recent events', () => {
    const store = createLog({ capacity: 3 });
    for (const n of [1, 2, 3, 4, 5]) store.log({ op: 'x', message: String(n) });

    // A long-running PWA session must not grow the buffer without limit; the newest
    // events are the ones worth keeping.
    expect(store.events().map((e) => e.message)).toEqual(['3', '4', '5']);
  });

  it('keeps working when the sink throws', () => {
    const store = createLog({
      sink: () => {
        throw new Error('network down');
      },
    });

    // Diagnostics must never become the thing that breaks a capture.
    expect(() => store.log({ op: 'capture', message: 'still recorded' })).not.toThrow();
    expect(store.events()).toHaveLength(1);
  });

  it('hands every event to the sink as it arrives', () => {
    const seen: LogEvent[] = [];
    const store = createLog({ sink: (e) => seen.push(e) });

    store.log({ op: 'http', message: 'chat request' });

    expect(seen).toHaveLength(1);
    expect(seen[0].message).toBe('chat request');
  });

  it('clears on request', () => {
    const store = createLog();
    store.log({ op: 'x', message: 'y' });
    store.clear();
    expect(store.events()).toEqual([]);
  });

  it('formats an event as a readable line', () => {
    const line = formatEvent({
      at: Date.UTC(2026, 7, 22, 13, 8, 33),
      level: 'error',
      op: 'http',
      message: 'chat request failed',
      detail: { status: 404 },
    });

    expect(line).toContain('2026-08-22T13:08:33.000Z');
    expect(line).toContain('ERROR');
    expect(line).toContain('chat request failed');
    expect(line).toContain('"status":404');
  });

  it('noopLog discards without throwing', () => {
    expect(() => noopLog({ op: 'x', message: 'y' })).not.toThrow();
  });
});

describe('the cloud seam reports the URL it actually called', () => {
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    llmProvider: '', // exactly the misconfiguration that caused the dogfooding bug
    llmModel: 'deepseek/deepseek-v4-flash',
    embedderModel: 'openai/text-embedding-3-small',
  };

  it('logs the resolved chat URL and puts it in the error, so a blank provider is visible', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('nope', { status: 404, statusText: 'Not Found' }),
    ) as unknown as typeof fetch;

    const store = createLog();
    const organizer = createOrganizer(settings, store.log);

    // A blank llmProvider makes this a relative URL — the whole point of logging it.
    await expect(organizer.organize('some thought', 'text')).rejects.toThrow('/chat/completions');

    const failure = store.events().find((e) => e.level === 'error');
    expect(failure).toBeDefined();
    expect(failure!.detail).toMatchObject({
      url: '/chat/completions',
      status: 404,
      model: 'deepseek/deepseek-v4-flash',
    });
  });

  it('logs the resolved embeddings URL on failure', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('nope', { status: 404, statusText: 'Not Found' }),
    ) as unknown as typeof fetch;

    const store = createLog();
    const embedder = createEmbedder(settings, store.log);

    await expect(embedder.embed(['a', 'b'])).rejects.toThrow('/embeddings');

    const failure = store.events().find((e) => e.level === 'error');
    expect(failure!.detail).toMatchObject({ url: '/embeddings', status: 404 });
  });

  it('never logs the API key', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('nope', { status: 401, statusText: 'Unauthorized' }),
    ) as unknown as typeof fetch;

    const store = createLog();
    const secret = 'sk-or-v1-super-secret-value';
    const organizer = createOrganizer({ ...settings, llmApiKey: secret }, store.log);

    await expect(organizer.organize('x', 'text')).rejects.toThrow();

    // The log is meant to be pasted into a conversation or committed to a scratch file;
    // a credential leaking into it would be a real problem.
    expect(store.format()).not.toContain(secret);
  });
});

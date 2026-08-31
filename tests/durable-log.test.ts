// The persistent half of the diagnostics log (src/lib/durable-log.ts) — the half that
// survives the reload which killed the failure it recorded. In-memory alone, a phone-only
// failure ended a session and took its own evidence with it (host ticket 02). These tests
// pin the durable contract at the seam logger.ts already names as the one tests use:
// events survive a restart, eviction is oldest-first, export is byte-compatible with the
// dev log file, and a failing store never breaks logging.
import { describe, it, expect, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createPersistedLog, serializeEventsJsonl } from '../src/lib/durable-log';
import type { LogEvent } from '../src/lib/logger';

// A fresh IndexedDB per test — fake-indexeddb keeps one global factory otherwise.
afterEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('the persistent log', () => {
  it('keeps events logged before a simulated restart', async () => {
    const first = createPersistedLog();
    first.log({ op: 'capture', message: 'first thought' });
    first.log({ op: 'http', message: 'chat request failed', level: 'error', detail: { status: 500 } });
    await first.flush();

    // A new instance over the same IndexedDB is the restart: nothing in memory survives,
    // only what the durable store retained.
    const second = createPersistedLog();
    await second.hydrate();

    const messages = second.events().map((e) => e.message);
    expect(messages).toEqual(['first thought', 'chat request failed']);
  });

  it('orders hydrated events before in-session ones — a boot merges yesterday behind today', async () => {
    const first = createPersistedLog();
    first.log({ op: 'capture', message: 'yesterday' });
    await first.flush();

    const second = createPersistedLog();
    second.log({ op: 'capture', message: 'today' });
    await second.hydrate();

    expect(second.events().map((e) => e.message)).toEqual(['yesterday', 'today']);
  });

  it('works immediately, before hydration lands', async () => {
    // The log must be usable the moment the app boots — hydration is async, logging is not.
    const store = createPersistedLog();
    expect(() => store.log({ op: 'capture', message: 'before hydration' })).not.toThrow();
    expect(store.events().map((e) => e.message)).toEqual(['before hydration']);
  });

  it('hydrates events that were logged before the store was ready to mirror them', async () => {
    // An event that arrives between boot and hydration must not be lost by the merge.
    const first = createPersistedLog();
    first.log({ op: 'capture', message: 'yesterday' });
    await first.flush();

    const second = createPersistedLog();
    second.log({ op: 'capture', message: 'today' });
    second.log({ op: 'capture', message: 'later today' });
    await second.hydrate();

    expect(second.events().map((e) => e.message)).toEqual(['yesterday', 'today', 'later today']);
  });

  it('evicts the oldest persisted events at the persisted capacity', async () => {
    const store = createPersistedLog({ persistedCapacity: 3 });
    for (const m of ['one', 'two', 'three', 'four', 'five']) store.log({ op: 'x', message: m });
    await store.flush();

    const second = createPersistedLog({ persistedCapacity: 3 });
    await second.hydrate();
    expect(second.events().map((e) => e.message)).toEqual(['three', 'four', 'five']);
  });

  it('keeps the in-memory buffer at its own capacity independent of persistence', () => {
    const store = createPersistedLog({ persistedCapacity: 2, capacity: 3 });
    for (const m of ['one', 'two', 'three', 'four']) store.log({ op: 'x', message: m });
    expect(store.events().map((e) => e.message)).toEqual(['two', 'three', 'four']);
  });

  it('clears the durable store too, so a restart does not resurrect the log', async () => {
    const store = createPersistedLog();
    store.log({ op: 'x', message: 'gone after clear' });
    await store.flush();

    store.clear();
    await store.flush();

    const second = createPersistedLog();
    await second.hydrate();
    expect(second.events()).toEqual([]);
  });

  it('clear wins over an in-flight append, but never swallows what is logged after it', async () => {
    const store = createPersistedLog();
    // An unawaited append is in flight the moment the user presses Clear.
    store.log({ op: 'x', message: 'in flight when cleared' });
    store.clear();
    store.log({ op: 'x', message: 'caught after clear' });
    await store.flush();

    const second = createPersistedLog();
    await second.hydrate();
    // IndexedDB commits same-store transactions in creation order: the append issued
    // before the clear is deleted by it. Anything logged after the Clear is a new event,
    // and Clear has no right to eat it.
    expect(second.events().map((e) => e.message)).toEqual(['caught after clear']);
  });

  it('hands every event to the sink as it arrives, like an in-memory log', () => {
    const seen: LogEvent[] = [];
    const store = createPersistedLog({ sink: (e) => seen.push(e) });
    store.log({ op: 'http', message: 'chat request' });
    expect(seen).toHaveLength(1);
    expect(seen[0].message).toBe('chat request');
  });

  it('logs even when the durable store refuses to write', () => {
    const store = createPersistedLog({
      events: {
        loadAll: async () => [],
        append: async () => {
          throw new Error('storage full');
        },
        clear: async () => {},
      },
    });

    // Diagnostics must never become the thing that breaks a capture — same contract the
    // dev sink holds.
    expect(() => store.log({ op: 'capture', message: 'recorded anyway' })).not.toThrow();
    expect(store.events()).toHaveLength(1);
  });

  it('exports events as one JSON object per line, byte-compatible with the dev log', () => {
    const devLogLines: string[] = [];
    const store = createPersistedLog({
      sink: (e) => devLogLines.push(JSON.stringify(e)),
    });

    store.log({ op: 'capture', message: 'a', detail: { dumpId: 'd1' } });
    store.log({ level: 'error', op: 'write', message: 'b', detail: { size: 42 } });

    const text = serializeEventsJsonl(store.events());

    // Byte-compatible by construction with what the dev sink appends to logs/brain-dump.jsonl:
    // one JSON.stringify(event) per line, newline-terminated — one format, whatever the origin.
    expect(text).toBe(devLogLines.join('\n') + '\n');
    expect(text.split('\n').filter(Boolean)).toHaveLength(2);
    expect(JSON.parse(text.split('\n')[0])).toMatchObject({ op: 'capture', message: 'a' });
  });
});
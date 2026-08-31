// The durable half of the diagnostics log (see logger.ts for the logging seam itself).
//
// The in-memory ring buffer dies with the page — which is exactly when a phone-only
// failure ends a session and takes its own evidence with it (host ticket 02). This module
// puts persistence under that seam, without changing it: a LogStore that behaves exactly
// like the in-memory one, but writes each event through to IndexedDB as it arrives and
// loads the retained events back on boot. The human-readable format()/Copy half of the
// log is untouched; what is new is the export — raw events, one JSON object per line,
// byte-compatible with what the dev sink appends to logs/brain-dump.jsonl, so one format
// serves both origins (host spec, ticket 02).
//
// Diagnostics are never load-bearing: a failing store must never break an operation being
// logged, the same contract the dev sink holds (logger.ts).
import { formatEvent, DEFAULT_CAPACITY, type LogEvent, type LogStore } from './logger';
import { openAppDb, LOG_STORE } from './idb';

export const DEFAULT_PERSISTED_CAPACITY = 200;

/** The durable storage a persistent log writes through to. Durability only — ordering of
 *  loads, what the export contains, and the in-memory policy live here, above the store. */
export interface LogEventStore {
  loadAll(): Promise<LogEvent[]>;
  append(event: LogEvent): Promise<void>;
  /** The store enforces its own retention on append; this wipes everything — the durable
   *  half of the UI's Clear. */
  clear(): Promise<void>;
}

/** The retained events as the dev log file would hold them: one JSON object per line,
 *  newline-terminated. The dev sink serializes each event with `JSON.stringify` and the
 *  dev middleware appends that line with a trailing newline, so this output and that
 *  file's are byte-identical for the same events by construction. */
export function serializeEventsJsonl(events: readonly LogEvent[]): string {
  if (!events.length) return '';
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

/** The real durable store: the app's shared IndexedDB database, one record per event
 *  keyed by an auto-incrementing `seq` that preserves capture order. Retention is its own
 *  business — bounded at `capacity` events, oldest evicted on append — so the log can
 *  never grow without limit however long the PWA lives. */
export function createIndexedDbLogEventStore(capacity = DEFAULT_PERSISTED_CAPACITY): LogEventStore {
  /** Delete the `n` oldest records, in place, within the caller's transaction. */
  const removeOldest = (n: number, s: IDBObjectStore): void => {
    if (n <= 0) return;
    // A full-values cursor, not openKeyCursor: fake-indexeddb aborts a readwrite
    // transaction whose deletes come from a key-only cursor.
    const cursorReq = s.openCursor();
    let left = n;
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor || left <= 0) return;
      cursor.delete();
      left -= 1;
      cursor.continue();
    };
  };

  /** Run work over one readwrite transaction on the log store, resolving once it has
   *  committed. Like idb.ts's txn(), but for requests whose work is issued by a callback
   *  (the eviction cursor) rather than returned up front. */
  const writeTxn = (run: (s: IDBObjectStore) => void): Promise<void> =>
    openAppDb().then(
      (db) =>
        new Promise<void>((resolve, reject) => {
          const tx = db.transaction(LOG_STORE, 'readwrite');
          run(tx.objectStore(LOG_STORE));
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        }),
    );

  return {
    async loadAll(): Promise<LogEvent[]> {
      const db = await openAppDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(LOG_STORE, 'readonly');
        const req = tx.objectStore(LOG_STORE).getAll();
        tx.oncomplete = () => {
          const rows = (req.result as { seq: number; event: LogEvent }[]).sort(
            (a, b) => a.seq - b.seq,
          );
          resolve(rows.map((r) => r.event));
        };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    },

    async append(event: LogEvent): Promise<void> {
      await writeTxn((s) => {
        s.add({ event });
        // Retention is measured in this same transaction — the count query sees the add
        // above plus every already-committed one, so concurrent appends (log() issues
        // them unawaited) can neither double-trim nor skip the trim.
        const countReq = s.count();
        countReq.onsuccess = () => removeOldest(countReq.result - capacity, s);
      });
    },

    async clear(): Promise<void> {
      await writeTxn((s) => {
        s.clear();
      });
    },
  };
}

/** A LogStore that survives restarts. Identical to the in-memory log in every way —
 *  synchronous `log`, bounded buffer, readable via `events()` — plus two async edges:
 *  `hydrate()` loads what previous sessions retained (safe to call at boot; in-session
 *  events logged before it lands are merged, not lost), and `flush()` resolves when every
 *  pending durable write has settled (for tests; the app itself fire-and-forgets writes,
 *  which may fail silently). */
export function createPersistedLog(opts: {
  /** The durable store. Defaulted to the app's IndexedDB log store; omit (or run
   *  somewhere without IndexedDB) for an in-memory log. */
  events?: LogEventStore;
  /** The in-memory working buffer — a separate bound from persistence, per the host spec. */
  capacity?: number;
  persistedCapacity?: number;
  now?: () => number;
  sink?: (event: LogEvent) => void;
} = {}): LogStore & { hydrate(): Promise<void>; flush(): Promise<void> } {
  const now = opts.now ?? (() => Date.now());
  const capacity = opts.capacity ?? DEFAULT_CAPACITY;
  // The in-memory and persisted bounds are independent (host spec): the working buffer
  // trims what it displays, the durable store trims what it keeps.
  const persistedCapacity = opts.persistedCapacity ?? DEFAULT_PERSISTED_CAPACITY;
  const durable =
    opts.events ??
    (typeof indexedDB !== 'undefined' ? createIndexedDbLogEventStore(persistedCapacity) : undefined);

  let events: LogEvent[] = [];
  let writes: Promise<unknown>[] = [];
  const keyOf = (e: LogEvent) => JSON.stringify(e);

  return {
    log(input) {
      const event: LogEvent = { at: now(), level: input.level ?? 'info', ...input };
      events = [...events, event].slice(-capacity);
      try {
        opts.sink?.(event);
      } catch {
        /* a failing sink must never break logging */
      }
      if (!durable) return;
      const write = durable
        .append(event)
        .catch(() => {
          /* failing storage must never break logging either */
        })
        .then(() => {
          writes = writes.filter((w) => w !== write);
        });
      writes.push(write);
    },

    events: () => [...events],

    format: () => events.map(formatEvent).join('\n'),

    clear: (): void => {
      events = [];
      void durable?.clear().catch(() => undefined);
    },

    /** Load what previous sessions retained. Meant once, at boot: merging is display
     *  only — loaded events were already written when they were first logged. A loaded
     *  event byte-equal to one already in the buffer is that same write seen in the
     *  store's snapshot (the write raced the load's `getAll` either way), so it pairs
     *  against the in-memory copy and is not displayed twice. */
    async hydrate(): Promise<void> {
      if (!durable) return;
      const loaded = await durable.loadAll();
      if (!loaded.length) return;
      const mine = new Map<string, number>();
      for (const e of events) mine.set(keyOf(e), (mine.get(keyOf(e)) ?? 0) + 1);
      const notMine = loaded.filter((e) => {
        const k = keyOf(e);
        const n = mine.get(k) ?? 0;
        if (n === 0) return true;
        mine.set(k, n - 1);
        return false;
      });
      events = [...notMine, ...events].slice(-capacity);
    },

    async flush(): Promise<void> {
      await Promise.allSettled(writes);
    },
  };
}
// A structured event log for diagnosing the app while it runs against a real vault.
//
// The browser cannot write to the project folder, so this is two halves: an in-memory
// ring buffer (always on, cheap, readable from the UI) plus an optional sink. In dev,
// App.svelte wires the sink to `createDevFileSink()`, which POSTs each event to a Vite
// middleware that appends it to `logs/brain-dump.jsonl` — so a real file lands in the
// project folder for a human or an agent to read. In a production build there is no
// middleware and no sink; the ring buffer alone remains.
//
// Events never carry Dump or Note *content*, only paths, lengths, and outcomes. That
// keeps a file full of personal thoughts from accumulating on disk, and keeps the log
// safe to paste into a conversation. Credentials are never logged at all.

export type LogLevel = 'info' | 'error';

/** One thing that happened, with enough context to act on it. `op` names the operation
 *  (`capture`, `organize`, `write`, `drain`, `retrieve`, `http`), `detail` carries the
 *  specifics — for an HTTP failure, the *resolved* URL, which is what makes a
 *  misconfigured provider self-evident rather than a mystery 404. */
export interface LogEvent {
  at: number; // ms epoch
  level: LogLevel;
  op: string;
  message: string;
  detail?: Record<string, unknown>;
}

export type LogInput = Omit<LogEvent, 'at' | 'level'> & { level?: LogLevel };

/** The logging seam. The operation layer and the cloud seam depend only on this, so
 *  tests can pass a recording fake (or `noopLog`) and assert on what was emitted. */
export type Log = (event: LogInput) => void;

/** A log that discards everything — the default wherever a Log is optional, so adding
 *  logging to a code path never forces every caller to supply one. */
export const noopLog: Log = () => {};

export interface LogStore {
  log: Log;
  /** Every retained event, oldest first. */
  events: () => LogEvent[];
  /** The retained events as human-readable lines — what the UI's Copy button yields. */
  format: () => string;
  clear: () => void;
}

const DEFAULT_CAPACITY = 300;

/** An in-memory ring buffer of the last `capacity` events, with an optional sink called
 *  for each one as it arrives. The buffer is bounded so a long-running PWA session cannot
 *  grow it without limit; the sink is where durability (the dev log file) comes from. */
export function createLog(opts: {
  now?: () => number;
  capacity?: number;
  sink?: (event: LogEvent) => void;
} = {}): LogStore {
  const now = opts.now ?? (() => Date.now());
  const capacity = opts.capacity ?? DEFAULT_CAPACITY;
  let events: LogEvent[] = [];

  return {
    log(input) {
      const event: LogEvent = { at: now(), level: input.level ?? 'info', ...input };
      events.push(event);
      if (events.length > capacity) events = events.slice(-capacity);
      // A failing sink must never break the operation being logged.
      try {
        opts.sink?.(event);
      } catch {
        /* ignore */
      }
    },
    events: () => [...events],
    format: () => events.map(formatEvent).join('\n'),
    clear: () => {
      events = [];
    },
  };
}

/** One event as a readable line: `2026-08-22T13:08:33.123Z ERROR organize  <message>  {detail}`. */
export function formatEvent(e: LogEvent): string {
  const when = new Date(e.at).toISOString();
  const level = e.level === 'error' ? 'ERROR' : 'INFO ';
  const detail = e.detail && Object.keys(e.detail).length ? '  ' + JSON.stringify(e.detail) : '';
  return `${when} ${level} ${e.op.padEnd(9)} ${e.message}${detail}`;
}

/** The dev-only sink: POST each event to the Vite middleware that appends it to
 *  `logs/brain-dump.jsonl`. Fire-and-forget with `keepalive` so an event emitted during
 *  page teardown still lands, and silent on failure — diagnostics must never become the
 *  thing that breaks a capture. Returns undefined outside a browser (or without fetch),
 *  so callers can pass the result straight through as an optional sink. */
export function createDevFileSink(endpoint = '/__brain-dump-log'): ((e: LogEvent) => void) | undefined {
  if (typeof fetch !== 'function') return undefined;
  return (event) => {
    void fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      keepalive: true,
    }).catch(() => undefined);
  };
}

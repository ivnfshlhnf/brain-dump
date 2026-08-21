// The autosave driver for the capture review flow. After the user stops adding
// Context for 5s, the pending Note is finalized (final Organize over the full
// Dump + write + freeze). The UI calls `schedule()` on each Context edit and
// `flush()` on `beforeunload` (close before the timer fires). A thin, testable
// orchestration helper over the operation layer — the timing is the behavior.

export const AUTOSAVE_DELAY_MS = 5000;

export interface Autosaver {
  /** (Re)schedule the save after activity — resets the idle timer. */
  schedule(): void;
  /** Save now (e.g. on close) and cancel any pending timer. */
  flush(): Promise<void>;
  /** Cancel any pending save without saving. */
  cancel(): void;
}

export function createAutosaver(opts: {
  delayMs?: number;
  save: () => Promise<void>;
}): Autosaver {
  const delayMs = opts.delayMs ?? AUTOSAVE_DELAY_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let saving = false;

  // Coalesce overlapping saves: the final Organize must run once over the full
  // Dump, not re-enter while a save is already in flight.
  async function run() {
    if (saving) return;
    saving = true;
    try {
      await opts.save();
    } finally {
      saving = false;
    }
  }

  return {
    schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void run();
      }, delayMs);
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await run();
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
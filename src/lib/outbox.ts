// The offline outbox: Dumps captured with no connection are queued here until a
// reconnect syncs them to CouchDB and Organizes them into Notes (see the operation
// layer's `captureOrQueue` / `drainOutbox`). IndexedDB is the durable store — a
// queued Dump survives a reload, a crash, or a closed tab.
import { openAppDb, txn, OUTBOX_STORE } from './idb';
import type { Dump, OutboxStore } from './types';

/** The real, durable outbox. Each Dump is keyed by its id, so re-adding the same
 *  Dump (e.g. a retried capture) replaces rather than duplicates it. */
export function createIndexedDbOutbox(): OutboxStore {
  return {
    async add(dump: Dump): Promise<void> {
      const db = await openAppDb();
      await txn(db, OUTBOX_STORE, 'readwrite', (s) => s.put(dump, dump.id));
    },

    /** Queued Dumps in capture order (FIFO) — they are Organized in the order the
     *  thoughts occurred. */
    async list(): Promise<Dump[]> {
      const db = await openAppDb();
      const all = await txn<Dump[]>(db, OUTBOX_STORE, 'readonly', (s) => s.getAll());
      return all.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    },

    async remove(id: string): Promise<void> {
      const db = await openAppDb();
      await txn(db, OUTBOX_STORE, 'readwrite', (s) => s.delete(id));
    },
  };
}

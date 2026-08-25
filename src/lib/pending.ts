// The Pending store: every Dump that has been Captured but whose Note does not exist
// yet (CONTEXT.md: Pending). A Dump enrols the moment it is Captured — offline,
// in-flight, or retrying after a failure — and leaves only once its Note has been
// written. IndexedDB is the durable store, so a Pending Dump survives a reload, a
// crash, or a tab killed mid-Organize: the interruption that stranded four Dumps
// silently before this existed (dogfooding finding 02).
//
// Policy lives in the operation layer (`recoverPending`); this is durability only.
import { openAppDb, txn, PENDING_STORE } from './idb';
import type { PendingDump, PendingStore } from './types';

/** The real, durable Pending store. Each record is keyed by its Dump's id, so saving
 *  the same Dump again (a reason change, a failed attempt) replaces rather than
 *  duplicates it. */
export function createIndexedDbPendingStore(): PendingStore {
  return {
    async save(record: PendingDump): Promise<void> {
      const db = await openAppDb();
      await txn(db, PENDING_STORE, 'readwrite', (s) => s.put(record, record.dump.id));
    },

    async get(id: string): Promise<PendingDump | undefined> {
      const db = await openAppDb();
      return txn<PendingDump | undefined>(db, PENDING_STORE, 'readonly', (s) => s.get(id));
    },

    /** Pending Dumps in capture order (FIFO) — they are Organized in the order the
     *  thoughts occurred. */
    async list(): Promise<PendingDump[]> {
      const db = await openAppDb();
      const all = await txn<PendingDump[]>(db, PENDING_STORE, 'readonly', (s) => s.getAll());
      return all.sort(
        (a, b) => a.dump.createdAt - b.dump.createdAt || a.dump.id.localeCompare(b.dump.id),
      );
    },

    async remove(id: string): Promise<void> {
      const db = await openAppDb();
      await txn(db, PENDING_STORE, 'readwrite', (s) => s.delete(id));
    },
  };
}

// Dumps the user has seen in the Stranded list and decided not to file (CONTEXT.md:
// Dismissed). Dismissing writes nothing to the Vault — "stop telling me about this" and
// "destroy this thought" are different intentions, and only the first is what clearing
// the list requires. Deleting a Dump for real is one tap in Obsidian, which is the right
// tool for it; Principle 1 says this app does not remove thoughts.
//
// Device-local, like the Pending store and for the same reason (ADR-0005).
import { openAppDb, txn, DISMISSED_STORE } from './idb';
import type { DismissedStore } from './types';

export function createIndexedDbDismissedStore(): DismissedStore {
  return {
    async dismiss(id: string): Promise<void> {
      const db = await openAppDb();
      await txn(db, DISMISSED_STORE, 'readwrite', (s) => s.put(Date.now(), id));
    },

    /** The ids of every Dismissed Dump. */
    async list(): Promise<string[]> {
      const db = await openAppDb();
      const keys = await txn<IDBValidKey[]>(db, DISMISSED_STORE, 'readonly', (s) => s.getAllKeys());
      return keys.map(String);
    },

    /** Undo a dismissal — the Dump returns to the Stranded list on the next reconcile. */
    async restore(id: string): Promise<void> {
      const db = await openAppDb();
      await txn(db, DISMISSED_STORE, 'readwrite', (s) => s.delete(id));
    },
  };
}

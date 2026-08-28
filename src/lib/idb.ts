// The app's single IndexedDB database, shared by the settings store and the Pending
// store. Both live in one database so they share a version — adding a store means
// bumping VERSION here and creating it in the upgrade below.

import type { Dump, PendingDump } from './types';

const DB_NAME = 'brain-dump';
const VERSION = 5; // v1: settings; v2: + outbox; v3: outbox→PendingDump; v4: + dismissed; v5: + note-cards

export const SETTINGS_STORE = 'settings';
/** The Pending store. The *key* is still `outbox` — the name it was created under in v2 —
 *  so no data has to move for the rename. The vocabulary changed (CONTEXT.md: Pending),
 *  the bytes did not. */
export const PENDING_STORE = 'outbox';
/** Dumps the user has seen in the Stranded list and chosen not to file. Their own store
 *  rather than a `reason` on a Pending record: a Dismissed Dump is not Pending — no Note
 *  is coming for it — and CONTEXT.md keeps those two words apart. */
export const DISMISSED_STORE = 'dismissed';
/** The home grid's card projection, cached device-local so the grid paints before the Vault
 *  read completes (ADR-0007). Disposable — rebuilt from the Vault in one pass when absent. */
export const CARD_CACHE_STORE = 'note-cards';

/** Open the app database, creating any missing object stores. Opened per operation
 *  rather than cached, so a store handle never outlives the connection it holds. */
export function openAppDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      // Tolerant of upgrading from v1 (where `settings` already exists).
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) db.createObjectStore(SETTINGS_STORE);
      if (!db.objectStoreNames.contains(PENDING_STORE)) db.createObjectStore(PENDING_STORE);
      if (!db.objectStoreNames.contains(DISMISSED_STORE)) db.createObjectStore(DISMISSED_STORE);
      if (!db.objectStoreNames.contains(CARD_CACHE_STORE)) db.createObjectStore(CARD_CACHE_STORE);
      if (event.oldVersion >= 2 && event.oldVersion < 3) migrateBareDumps(req.transaction);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** v2 stored a bare `Dump` per key; v3 stores a `PendingDump` envelope around it. Wrap
 *  whatever is already there rather than dropping it: an entry in this store is a thought
 *  that has not become a Note yet, which is the one thing this store exists to not lose.
 *
 *  A v2 entry could only have been captured offline or after a failed capture, and both
 *  retry the same way, so `offline` is the honest label for it. */
function migrateBareDumps(tx: IDBTransaction | null): void {
  if (!tx) return;
  const cursorReq = tx.objectStore(PENDING_STORE).openCursor();
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (!cursor) return;
    const value = cursor.value as Record<string, unknown> | undefined;
    // Typed on the way out: this function's whole job is not losing a thought, so a typo
    // in `reason` should be a compile error rather than a record recovery silently skips.
    if (value && !('dump' in value) && typeof value.content === 'string') {
      const wrapped: PendingDump = {
        dump: value as unknown as Dump,
        reason: 'offline',
        enrolledAt: typeof value.createdAt === 'number' ? value.createdAt : 0,
        attempts: 0,
      };
      cursor.update(wrapped);
    }
    cursor.continue();
  };
}

/** Run a transaction over one store, resolving with the request's result once the
 *  transaction has committed — so a resolved write is durably stored, not just queued. */
export function txn<T>(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = run(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error ?? req.error);
    tx.onabort = () => reject(tx.error ?? req.error);
  });
}

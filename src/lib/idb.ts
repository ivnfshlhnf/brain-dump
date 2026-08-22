// The app's single IndexedDB database, shared by the settings store and the offline
// outbox. Both live in one database so they share a version — adding a store means
// bumping VERSION here and creating it in the upgrade below.

const DB_NAME = 'brain-dump';
const VERSION = 2; // v1: settings; v2: + outbox

export const SETTINGS_STORE = 'settings';
export const OUTBOX_STORE = 'outbox';

/** Open the app database, creating any missing object stores. Opened per operation
 *  rather than cached, so a store handle never outlives the connection it holds. */
export function openAppDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Tolerant of upgrading from v1 (where `settings` already exists).
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) db.createObjectStore(SETTINGS_STORE);
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) db.createObjectStore(OUTBOX_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
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

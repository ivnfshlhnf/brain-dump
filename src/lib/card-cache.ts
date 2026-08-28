// The home grid's card projection, cached device-local so the grid paints before the Vault
// read completes (ADR-0007). Disposable by design: the Vault is the source of truth and the
// cache only buys a paint-before-the-read, so losing it (a cleared site, a failed upgrade) is
// harmless — it is rebuilt from the Vault in one pass on the next open.
//
// The whole projection is stored under one key. It is read as a list and rebuilt as a list,
// so there is nothing to be gained from keying per-Note; a single record keeps the read and
// the write to one transaction each.
import { openAppDb, txn, CARD_CACHE_STORE } from './idb';
import type { NoteCard, NoteCardCache } from './types';

/** The single key the projection is stored under. */
const ALL = 'all';

export function createIndexedDbCardCache(): NoteCardCache {
  return {
    async write(cards: NoteCard[]): Promise<void> {
      const db = await openAppDb();
      await txn(db, CARD_CACHE_STORE, 'readwrite', (s) => s.put(cards, ALL));
    },

    /** Every cached card, or `[]` when the cache is absent or empty. */
    async list(): Promise<NoteCard[]> {
      const db = await openAppDb();
      return (await txn<NoteCard[] | undefined>(db, CARD_CACHE_STORE, 'readonly', (s) => s.get(ALL))) ?? [];
    },
  };
}

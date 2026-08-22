// IndexedDB-backed settings store. App-only (not exercised by the operation-layer seam).
import { openAppDb, txn, SETTINGS_STORE } from './idb';
import { DEFAULT_SETTINGS, type Settings } from './types';

const KEY = 'current';

export async function loadSettings(): Promise<Settings> {
  try {
    const db = await openAppDb();
    const stored = await txn<Partial<Settings> | undefined>(db, SETTINGS_STORE, 'readonly', (s) =>
      s.get(KEY),
    );
    return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  const db = await openAppDb();
  await txn(db, SETTINGS_STORE, 'readwrite', (s) => s.put(settings, KEY));
}

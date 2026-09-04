// IndexedDB-backed settings store. App-only (not exercised by the operation-layer seam).
import { openAppDb, txn, SETTINGS_STORE } from './idb';
import { DEFAULT_SETTINGS, type Settings } from './types';

const KEY = 'current';

/** The schema version this build of the app reads and writes. Bumping it declares a
 *  one-time migration below: a stored record older than it is brought forward on load. */
const SETTINGS_VERSION = 1;

/** Bring a record saved before the Style forward: its empty `organizeInstruction` would
 *  otherwise silently override the Style default forever. The fill is persisted, which is
 *  what makes it one-time — once the record carries the current version, an emptied
 *  instruction is the user's deliberate act (the Style's escape hatch) and is left alone.
 *  A pre-Style record that already carries an Instruction keeps its own words. */
async function migrate(stored: Partial<Settings>): Promise<Partial<Settings> | null> {
  if ((stored.settingsVersion ?? 0) >= SETTINGS_VERSION) return null;
  const migrated = { ...stored, settingsVersion: SETTINGS_VERSION };
  if (!stored.organizeInstruction?.trim()) {
    migrated.organizeInstruction = DEFAULT_SETTINGS.organizeInstruction;
  }
  return migrated;
}

export async function loadSettings(): Promise<Settings> {
  try {
    const db = await openAppDb();
    const stored = await txn<Partial<Settings> | undefined>(db, SETTINGS_STORE, 'readonly', (s) =>
      s.get(KEY),
    );
    if (stored === undefined) return { ...DEFAULT_SETTINGS };
    const migrated = await migrate(stored);
    if (migrated) {
      await saveSettings({ ...DEFAULT_SETTINGS, ...migrated });
      return { ...DEFAULT_SETTINGS, ...migrated };
    }
    return { ...DEFAULT_SETTINGS, ...stored };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  const db = await openAppDb();
  await txn(db, SETTINGS_STORE, 'readwrite', (s) => s.put(settings, KEY));
}

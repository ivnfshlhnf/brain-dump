// Config persistence (Seam A — config): settings round-trip through IndexedDB, so a
// configured app still knows where the vault and the models live next session.
// Driven against fake-indexeddb — real IndexedDB semantics, no browser.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { loadSettings, saveSettings } from '../src/lib/settings';
import { DEFAULT_SETTINGS } from '../src/lib/types';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('settings', () => {
  it('defaults when nothing has been saved', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('persists the CouchDB, LLM, and embedder configuration between sessions', async () => {
    await saveSettings({
      ...DEFAULT_SETTINGS,
      couchdbUrl: 'http://localhost:5984',
      couchdbDb: 'obsidiannotes',
      llmModel: 'llama3.1',
      embedderModel: 'nomic-embed-text',
    });

    const loaded = await loadSettings();
    expect(loaded.couchdbUrl).toBe('http://localhost:5984');
    expect(loaded.couchdbDb).toBe('obsidiannotes');
    expect(loaded.llmModel).toBe('llama3.1');
    expect(loaded.embedderModel).toBe('nomic-embed-text');
  });
});

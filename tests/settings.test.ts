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

  it('ships the Style as the default standing instruction (CONTEXT.md: Style)', async () => {
    // The Style is the app's answer to "Notes should read like the user, not like an
    // assistant reporting on them" — it rides the standing-instruction seam, so it must
    // ship as that setting's default. A rephrase is fine; an empty default means the app
    // silently went back to assistant-speak — assert the load-bearing intent only.
    const style = DEFAULT_SETTINGS.organizeInstruction;
    expect(style.trim()).not.toBe('');
    expect(style).toMatch(/first person/i);
    expect(style).toMatch(/never say "the user"/);
    expect(style).toMatch(/never translate/i);
    expect(style).toMatch(/no template headings|never pad/i);
  });

  it('fills the Style into a stored record that predates it, and persists the fill', async () => {
    // A record saved before the Style existed holds organizeInstruction: '' — merged over
    // the defaults it would silently override the new default forever, so loadSettings
    // migrates it once: fill the instruction, bump the version, write it back. The write
    // is what makes it one-time: afterwards an emptied instruction is the user's choice.
    await saveSettings({
      ...DEFAULT_SETTINGS,
      settingsVersion: 0,
      organizeInstruction: '',
      couchdbUrl: 'http://localhost:5984',
    });

    const loaded = await loadSettings();
    expect(loaded.organizeInstruction).toBe(DEFAULT_SETTINGS.organizeInstruction);
    expect(loaded.settingsVersion).toBe(1);
    expect(loaded.couchdbUrl).toBe('http://localhost:5984'); // nothing else touched

    // The fill was persisted, not just shown.
    const reloaded = await loadSettings();
    expect(reloaded.organizeInstruction).toBe(DEFAULT_SETTINGS.organizeInstruction);
  });

  it('does not refill an instruction the user emptied after migrating', async () => {
    // Emptiness after the Style shipped is a deliberate act — the Style's escape hatch —
    // so a migrated record must never be re-filled.
    await saveSettings({ ...DEFAULT_SETTINGS, settingsVersion: 1, organizeInstruction: '' });

    const loaded = await loadSettings();
    expect(loaded.organizeInstruction).toBe('');
  });

  it('leaves a pre-Style record alone when it already carries a standing instruction', async () => {
    // Migration is for empty fields only: someone who wrote their own Instruction before
    // the Style existed keeps theirs verbatim.
    const mine = 'always write the note in English, regardless of the dump language';
    await saveSettings({ ...DEFAULT_SETTINGS, settingsVersion: 0, organizeInstruction: mine });

    const loaded = await loadSettings();
    expect(loaded.organizeInstruction).toBe(mine);
  });
});

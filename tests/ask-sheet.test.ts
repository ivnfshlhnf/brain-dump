// Seam A — the Ask sheet (ticket 07). Retrieve answers a question and cites the Notes it drew
// on; the Ask sheet shows those citations as the same cards the grid shows, tappable into the
// Note sheet. `citedCards` is the testable seam: it reads the cited Notes and projects them
// through the same `toCard` the grid uses, so a citation card is grid-identical. Tested as a black
// box with the in-memory PouchDB stand-in (the same discipline tests/note-sheet.test.ts uses).
import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import PouchDB from 'pouchdb-core';
import memory from 'pouchdb-adapter-memory';
import { writeNote, citedCards } from '../src/lib/operations';
import { docIdForPath } from '../src/lib/livesync';
import {
  DEFAULT_SETTINGS,
  type Settings,
  type DocStore,
  type Note,
  type Citation,
  type Modality,
} from '../src/lib/types';

PouchDB.plugin(memory);

function sha1Hex(content: string): Promise<string> {
  return Promise.resolve(createHash('sha1').update(content).digest('hex'));
}

const fixedNow = Date.UTC(2026, 7, 21, 20, 30, 45); // 2026-08-21 20:30:45 UTC
const settings: Settings = { ...DEFAULT_SETTINGS, dumpsFolder: '_dumps', managedFolder: 'Brain Dump' };

let db: DocStore;
let seq = 0;

beforeEach(() => {
  db = new PouchDB('ask' + seq++, { adapter: 'memory' }) as unknown as DocStore;
});

// --- helpers -------------------------------------------------------------

function makeNote(over: Partial<Note> = {}): Note {
  return {
    title: 'Water the plants',
    tags: ['home', 'plants'],
    createdAt: fixedNow,
    modality: 'text' as Modality,
    source: '[[_dumps/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee]]',
    category: 'personal',
    summary: 'A reminder to water the plants.',
    body: 'I keep forgetting to water the plants.',
    keyPoints: [],
    related: [],
    ...over,
  };
}

/** Write a Note into the managed folder via the real `writeNote`; return its path. */
async function seedNote(note: Note): Promise<string> {
  const written = await writeNote(note, db, settings, sha1Hex);
  return written.path;
}

/** A citation as `retrieve` would produce one: the Note's path and title, plus its wikilink. */
function citationFor(path: string, title: string): Citation {
  return { path, title, link: `[[${path.replace(/\.md$/, '')}]]` };
}

/** Soft-delete a Note the way Obsidian's sync does: mark its metadata doc `deleted: true`. */
async function softDelete(path: string): Promise<void> {
  const doc = await db.get<Record<string, unknown>>(docIdForPath(path, settings));
  await db.put({ ...doc, deleted: true });
}

// --- citedCards: the citations as grid-identical cards --------------------

describe('citedCards — the citations shown as the same cards the grid shows (ticket 07)', () => {
  it('projects each cited Note to a grid-identical card, in citation order', async () => {
    const plantsPath = await seedNote(makeNote({ title: 'Water the plants', tags: ['home', 'plants'], category: 'personal', summary: 'A reminder to water the plants.' }));
    const taxesPath = await seedNote(makeNote({ title: 'Taxes', tags: ['money'], category: 'productivity', summary: 'File before April.' }));

    // The answer cited Taxes first, then the plants — the cards follow that order, not the
    // grid's newest-first order, so the user reads the answer top-to-bottom into its sources.
    const citations = [citationFor(taxesPath, 'Taxes'), citationFor(plantsPath, 'Water the plants')];

    const cards = await citedCards(citations, { db, settings, hash: sha1Hex });

    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ path: taxesPath, title: 'Taxes', category: 'productivity', summary: 'File before April.', tags: ['money'] });
    expect(cards[1]).toMatchObject({ path: plantsPath, title: 'Water the plants', category: 'personal', summary: 'A reminder to water the plants.', tags: ['home', 'plants'] });
  });

  it('drops a citation whose Note was deleted between the answer and the read — no dead card', async () => {
    const livePath = await seedNote(makeNote({ title: 'Water the plants' }));
    const gonePath = await seedNote(makeNote({ title: 'Gone Note' }));
    await softDelete(gonePath); // Obsidian's own sync deletes the Note after the answer cited it.

    // The Vault read in citedCards excludes soft-deleted docs (readVaultFiles default), so a
    // Note deleted after the answer is simply absent — the card is dropped, not shown as a dead
    // link to a Note that is no longer there.
    const citations = [citationFor(livePath, 'Water the plants'), citationFor(gonePath, 'Gone Note')];

    const cards = await citedCards(citations, { db, settings, hash: sha1Hex });

    expect(cards).toHaveLength(1);
    expect(cards[0].path).toBe(livePath);
  });

  it('returns no cards when there were no citations — naming nothing is a real answer', async () => {
    const cards = await citedCards([], { db, settings, hash: sha1Hex });
    expect(cards).toEqual([]);
  });
});
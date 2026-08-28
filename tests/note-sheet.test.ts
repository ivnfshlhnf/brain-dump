// Seam A — the Note sheet (ticket 06). The grid's card is a door: tapping it opens the whole
// Note, at full length, with every Tag, the body, the Related links, the verbatim source Dump,
// and a re-organize that re-derives the metadata from the current body. Tested as black boxes
// through the operation layer; the Organizer is a deterministic fake and CouchDB is the
// in-memory PouchDB stand-in (the same discipline tests/append.test.ts uses).
import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import PouchDB from 'pouchdb-core';
import memory from 'pouchdb-adapter-memory';
import {
  writeNote,
  readNote,
  reorganizeNote,
  parseNote,
  noteFileContent,
  dumpPath,
  dumpFileContent,
  sourceWikilink,
} from '../src/lib/operations';
import { writeFile } from '../src/lib/livesync';
import {
  DEFAULT_SETTINGS,
  type Settings,
  type DocStore,
  type Dump,
  type Note,
  type Organizer,
  type OrganizeOutput,
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
  db = new PouchDB('note' + seq++, { adapter: 'memory' }) as unknown as DocStore;
});

// --- helpers -------------------------------------------------------------

const sampleOutput: OrganizeOutput = {
  title: 'Water the plants',
  tags: ['home', 'plants'],
  category: 'personal',
  summary: 'A reminder to water the plants.',
  keyPoints: ['Water the plants regularly', 'Use the calendar'],
  related: ['[[Brain Dump/2026-08-01-garden.md]]', '[[personal/garden]]'],
  body: 'I keep forgetting to water the plants. The basil is wilting again.',
};

/** A Dump whose file path matches the Note's default `source` wikilink target. */
function sourceDump(over: Partial<Dump> = {}): Dump {
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    content: 'i keep forgetting to water the plants',
    context: '',
    createdAt: fixedNow,
    modality: 'text' as Modality,
    ...over,
  };
}

function makeNote(over: Partial<Note> = {}): Note {
  const dump = sourceDump();
  return {
    title: 'Water the plants',
    tags: ['home', 'plants'],
    createdAt: fixedNow,
    modality: 'text' as Modality,
    source: sourceWikilink(dump, settings),
    category: 'personal',
    summary: 'A reminder to water the plants.',
    body: 'I keep forgetting to water the plants. The basil is wilting again.',
    keyPoints: ['Water the plants regularly', 'Use the calendar'],
    related: ['[[Brain Dump/2026-08-01-garden.md]]', '[[personal/garden]]'],
    ...over,
  };
}

/** Write a Note into the managed folder via the real `writeNote`; return its path. */
async function seedNote(note: Note): Promise<string> {
  const written = await writeNote(note, db, settings, sha1Hex);
  return written.path;
}

/** Write a Dump into the Vault's dumps folder, as a past session would have left it. */
async function seedDump(dump: Dump): Promise<void> {
  await writeFile(db, dumpPath(dump, settings), dumpFileContent(dump), {
    ctime: dump.createdAt,
    mtime: dump.createdAt,
    hash: sha1Hex,
    settings,
  });
}

// --- parseNote: the inverse of noteFileContent ---------------------------

describe('parseNote — the inverse of noteFileContent', () => {
  it('round-trips a Note written to disk back to the same Note, field for field', () => {
    const note = makeNote();
    const reconstructed = parseNote(noteFileContent(note));

    // Every structured field survives the write→read cycle, including the ones the card
    // truncates: the full body, every key point, and every Related link.
    expect(reconstructed).toEqual(note);
  });

  it('preserves a body that itself uses `##` headings — the trailing sections are the last ones', () => {
    // The organized body happens to contain a `## Summary`-shaped heading of its own. The
    // genuine trailing sections `noteFileContent` appends are the last in order, so the body's
    // own heading is kept in the body and the real Summary section is parsed separately.
    const note = makeNote({ body: 'A thought.\n\n## Summary of the day\n\nMore words.' });
    const reconstructed = parseNote(noteFileContent(note));

    expect(reconstructed.body).toBe('A thought.\n\n## Summary of the day\n\nMore words.');
    expect(reconstructed.summary).toBe(note.summary);
    expect(reconstructed.keyPoints).toEqual(note.keyPoints);
  });
});

// --- readNote: the Note the sheet shows -----------------------------------

describe('readNote — the full Note and its verbatim source (ticket 06)', () => {
  it('returns the full Note a card points at — title, every Tag, body, key points and Related', async () => {
    const path = await seedNote(makeNote());
    const view = await readNote(path, { db, settings, hash: sha1Hex });

    expect(view).not.toBeNull();
    expect(view!.note).toEqual(makeNote());
    expect(view!.path).toBe(path);
  });

  it('shows every Tag — a tag-heavy Note truncates on the card but not here', async () => {
    const tags = Array.from({ length: 10 }, (_, i) => `tag${i}`);
    const path = await seedNote(makeNote({ tags }));
    const view = await readNote(path, { db, settings, hash: sha1Hex });

    expect(view!.note.tags).toEqual(tags);
    expect(view!.note.tags).toHaveLength(10);
  });

  it('carries the verbatim source Dump — the user’s original words plus any Context', async () => {
    const dump = sourceDump({ content: 'the exact words I typed', context: 'added later' });
    const path = await seedNote(makeNote({ source: sourceWikilink(dump, settings) }));
    await seedDump(dump);

    const view = await readNote(path, { db, settings, hash: sha1Hex });

    expect(view!.dump).not.toBeNull();
    expect(view!.dump!.content).toBe('the exact words I typed');
    expect(view!.dump!.context).toBe('added later');
  });

  it('still reads the Note when its source Dump is gone — provenance is null, not a failure', async () => {
    const path = await seedNote(makeNote());
    // No Dump seeded: the Note cites a Dump that is no longer in the Vault.

    const view = await readNote(path, { db, settings, hash: sha1Hex });

    expect(view).not.toBeNull();
    expect(view!.note.title).toBe('Water the plants');
    expect(view!.dump).toBeNull();
  });

  it('returns null for a path that is not in the Vault', async () => {
    const view = await readNote('Brain Dump/does-not-exist.md', { db, settings, hash: sha1Hex });
    expect(view).toBeNull();
  });
});

// --- reorganizeNote: re-derive metadata from the current body -------------

describe('reorganizeNote — refresh the metadata against the current body (ticket 06)', () => {
  it('re-derives title, Tags, summary and Category from the body, and reads them back', async () => {
    const path = await seedNote(makeNote({ title: 'Old Title', tags: ['old'], category: 'uncategorized', summary: 'Old summary.' }));

    const refreshOrganizer: Organizer = {
      organize: async () => ({ ...sampleOutput, title: 'New Title', tags: ['new'], category: 'personal', summary: 'New summary.' }),
    };

    const view = await reorganizeNote(path, {
      db,
      settings,
      organizer: refreshOrganizer,
      hash: sha1Hex,
      now: () => fixedNow,
    });

    expect(view).not.toBeNull();
    expect(view!.note.title).toBe('New Title');
    expect(view!.note.tags).toEqual(['new']);
    expect(view!.note.category).toBe('personal');
    expect(view!.note.summary).toBe('New summary.');
  });

  it('preserves the body byte-for-byte — only the metadata is touched', async () => {
    const note = makeNote({ body: 'The body the user may have edited.' });
    const path = await seedNote(note);

    const view = await reorganizeNote(path, {
      db,
      settings,
      organizer: { organize: async () => ({ ...sampleOutput, title: 'New Title' }) },
      hash: sha1Hex,
      now: () => fixedNow,
    });

    expect(view!.note.body).toBe('The body the user may have edited.');
  });

  it('assigns a member Category to a legacy Note — old Notes join the colour system when touched', async () => {
    // A legacy Note carries a free-form Category ('Hardware'); it reads as `uncategorized`.
    const path = await seedNote(makeNote({ category: 'uncategorized' }));
    expect((await readNote(path, { db, settings, hash: sha1Hex }))!.note.category).toBe('uncategorized');

    // Re-organizing assigns a member Category from the closed set.
    const view = await reorganizeNote(path, {
      db,
      settings,
      organizer: { organize: async () => ({ ...sampleOutput, category: 'tools' }) },
      hash: sha1Hex,
      now: () => fixedNow,
    });

    expect(view!.note.category).toBe('tools');
  });

  it('organizes against the current body, not the stale trailing sections — a refresh is not coloured by its own metadata', async () => {
    // A Note on disk carries the trailing `## Summary` / `## Key points` / `## Related`
    // sections `noteFileContent` appends. Re-organizing must hand the organizer the user's
    // content body alone, or the re-derived title/Tags/summary are skewed by the old sections.
    const note = makeNote({
      body: 'The body the user actually wrote.',
      summary: 'An old summary that must not reach the organizer.',
      keyPoints: ['An old key point that must not reach the organizer'],
      related: ['[[old/related]]'],
    });
    const path = await seedNote(note);

    let organizedBody: string | null = null;
    const recordingOrganizer: Organizer = {
      organize: async (body: string) => {
        organizedBody = body;
        return sampleOutput;
      },
    };

    await reorganizeNote(path, {
      db,
      settings,
      organizer: recordingOrganizer,
      hash: sha1Hex,
      now: () => fixedNow,
    });

    expect(organizedBody).toBe('The body the user actually wrote.');
    expect(organizedBody).not.toContain('## Summary');
    expect(organizedBody).not.toContain('An old key point');
    expect(organizedBody).not.toContain('## Related');
  });
});
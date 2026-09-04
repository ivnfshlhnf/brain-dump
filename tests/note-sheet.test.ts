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

// --- parseNote: the layout the Append path once wrote (finding 06) --------

describe('parseNote — appends written below the trailing sections', () => {
  // The Append path once wrote its dated sections to the very end of the file — below
  // `## Related` (finding 06). Files in the Vault still carry that layout, so reading them
  // must not swallow the appended content into the Related list, nor lose it.
  const appendedBelow = (related: string[]) =>
    noteFileContent(makeNote({ related })) +
    '\n## Appended 2026-08-24 08:31:27 UTC\n\n' +
    '## Issue\n\nThe organized note is generated twice.\n\n' +
    '_Source: [[_dumps/20260824-083127-c662cc]]_\n';

  it('reads an appended section as body, never as Related links', () => {
    const note = parseNote(appendedBelow([]));

    expect(note.related).toEqual([]); // the appended headings are not links
    expect(note.body).toContain('## Appended 2026-08-24 08:31:27 UTC');
    expect(note.body).toContain('The organized note is generated twice.');
    expect(note.body).toContain('_Source: [[_dumps/20260824-083127-c662cc]]_');
  });

  it('keeps genuine Related links when appended sections sit below them', () => {
    const note = parseNote(appendedBelow(['[[Brain Dump/2026-08-01-garden]]']));

    expect(note.related).toEqual(['[[Brain Dump/2026-08-01-garden]]']);
    expect(note.body).toContain('## Appended 2026-08-24 08:31:27 UTC');
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

// --- reorganizeNote: the manual Re-organize (ADR-0009) ---------------------

describe('reorganizeNote — rebuild the Note wholesale from its Dump (the append rework)', () => {
  it('re-organizes from the accumulated Dump: body and frontmatter alike are regenerated, and read back', async () => {
    const dump = sourceDump();
    const path = await seedNote(
      makeNote({ source: sourceWikilink(dump, settings), title: 'Old Title', tags: ['old'], summary: 'Old summary.', body: 'A stale body.' }),
    );
    await seedDump(dump);

    const reorganizer: Organizer = {
      organize: async () => ({ ...sampleOutput, title: 'New Title', tags: ['new'], category: 'personal', summary: 'New summary.', body: 'The whole thought, re-organized.' }),
    };

    const view = await reorganizeNote(path, {
      db,
      settings,
      organizer: reorganizer,
      hash: sha1Hex,
      now: () => fixedNow,
    });

    expect(view).not.toBeNull();
    expect(view!.note.title).toBe('New Title');
    expect(view!.note.tags).toEqual(['new']);
    expect(view!.note.category).toBe('personal');
    expect(view!.note.summary).toBe('New summary.');
    expect(view!.note.body).toBe('The whole thought, re-organized.'); // regenerated, not preserved
    expect(view!.note.source).toBe(sourceWikilink(dump, settings)); // identity survives
  });

  it('a hand edit to the Note does not survive — the Dump is the record, the Note a view', async () => {
    const dump = sourceDump();
    const path = await seedNote(makeNote({ source: sourceWikilink(dump, settings) }));
    await seedDump(dump);
    // The user edited the Note in Obsidian.
    await writeFile(db, path, noteFileContent(makeNote({ source: sourceWikilink(dump, settings), body: 'A hand-written edit.' })), {
      ctime: fixedNow, mtime: fixedNow, hash: sha1Hex, settings,
    });

    const view = await reorganizeNote(path, {
      db,
      settings,
      organizer: { organize: async () => sampleOutput },
      hash: sha1Hex,
      now: () => fixedNow,
    });

    expect(view!.note.body).toContain('The basil is wilting again.'); // the organized body is back
    expect(view!.note.body).not.toBe('A hand-written edit.');
  });

  it('organizes against the accumulated Dump, not the Note\'s stale trailing sections', async () => {
    // The Note on disk carries the trailing `## Summary` / `## Key points` / `## Related`
    // sections and an out-of-date body. The re-organize hands the organizer the Dump's
    // verbatim content — the record — not the old rendering.
    const dump = sourceDump();
    const path = await seedNote(
      makeNote({
        source: sourceWikilink(dump, settings),
        body: 'A stale body that must not reach the organizer.',
        summary: 'An old summary that must not reach the organizer.',
      }),
    );
    await seedDump(dump);

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

    expect(organizedBody).toContain('i keep forgetting to water the plants'); // the Dump's verbatim capture
    expect(organizedBody).not.toContain('A stale body');
    expect(organizedBody).not.toContain('## Summary');
    expect(organizedBody).not.toContain('An old summary');
  });

  it('when the Note\'s Dump is gone, the Re-organize refuses — it never organizes the Note from itself', async () => {
    // The no-Dump fallback organized from the Note's own body, so repeated Re-organizes
    // drifted the derived fields away from the Dump's context (the user saw this). A Note
    // without its Dump is a view with no source: refusal, surfaced to the user, not a
    // silent re-derivation from the last output.
    const path = await seedNote(makeNote({ title: 'Old Title', tags: ['old'], category: 'uncategorized', summary: 'Old summary.', body: 'The body that remains.' }));

    let called = 0;
    await expect(
      reorganizeNote(path, {
        db,
        settings,
        organizer: { organize: async () => { called += 1; return { ...sampleOutput, title: 'New Title', tags: ['new'], category: 'personal', summary: 'New summary.' }; } },
        hash: sha1Hex,
        now: () => fixedNow,
      }),
    ).rejects.toThrow(/Dump is gone/);

    expect(called).toBe(0);
    const view = await readNote(path, { db, settings, hash: sha1Hex });
    expect(view!.note.title).toBe('Old Title'); // untouched
    expect(view!.note.body).toBe('The body that remains.');
  });

  it('assigns a member Category to a legacy Note — old Notes join the colour system when touched', async () => {
    // A legacy Note carries a free-form Category ('Hardware'); it reads as `uncategorized`.
    const dump = sourceDump();
    const path = await seedNote(makeNote({ category: 'uncategorized' }));
    await seedDump(dump);
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
});
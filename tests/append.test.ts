// Seam A — append a Dump to an existing Note (ticket 04): LLM-assisted match,
// dated-section append, edit preservation, optimistic-concurrency 409 retry,
// and explicit (never automatic) metadata refresh. Driven as black boxes; the
// Matcher/Organizer are deterministic fakes and CouchDB is the in-memory PouchDB.
import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import PouchDB from 'pouchdb-core';
import memory from 'pouchdb-adapter-memory';
import {
  writeNote,
  matchNote,
  appendDumpToNote,
  refreshNoteMetadata,
  beginCapture,
  finalizeCapture,
  type WriteResult,
} from '../src/lib/operations';
import { docIdForPath } from '../src/lib/livesync';
import {
  DEFAULT_SETTINGS,
  type Settings,
  type DocStore,
  type Note,
  type Organizer,
  type OrganizeOutput,
  type Matcher,
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
  db = new PouchDB('ap' + seq++, { adapter: 'memory' }) as unknown as DocStore;
});

// --- helpers -------------------------------------------------------------

const sampleOutput: OrganizeOutput = {
  title: 'Water the plants',
  tags: ['home', 'plants'],
  category: 'personal',
  summary: 'A reminder to water the plants.',
  keyPoints: ['Water the plants regularly'],
  related: ['[[plants]]'],
  body: 'I keep forgetting to water the plants.',
};

function makeNote(over: Partial<Note> = {}): Note {
  return {
    title: 'Water the plants',
    tags: ['home', 'plants'],
    createdAt: fixedNow,
    modality: 'text' as Modality,
    source: '[[_dumps/20260821-203045-aaaaaa]]',
    category: 'personal',
    summary: 'A reminder to water the plants.',
    body: 'I keep forgetting to water the plants.',
    keyPoints: ['Water the plants regularly'],
    related: ['[[plants]]'],
    ...over,
  };
}

/** Seed an existing Note into the managed folder; return its vault-relative path. */
async function seedNote(note: Note): Promise<string> {
  const written = await writeNote(note, db, settings, sha1Hex);
  return written.path;
}

/** Read the current raw content of a Note file (its single chunk's `data`). */
async function noteContent(path: string): Promise<string> {
  const meta = await db.get<{ children: string[] }>(docIdForPath(path, settings));
  const chunk = await db.get<{ data: string }>(meta.children[0]);
  return chunk.data;
}

const newOnlyMatcher: Matcher = { match: async () => ({ kind: 'new' }) };
const appendToFirstMatcher: Matcher = {
  match: async (_topic, candidates) => ({ kind: 'append', path: candidates[0].path }),
};

const organizer: Organizer = {
  organize: async () => sampleOutput,
};

// --- matching ------------------------------------------------------------

describe('matchNote (Seam A — ticket 04)', () => {
  it('suggests append to the matched existing Note (LLM-assisted, by tags/topic)', async () => {
    const path = await seedNote(makeNote());

    const decision = await matchNote(makeNote(), db, settings, appendToFirstMatcher);

    expect(decision.kind).toBe('append');
    expect(decision.suggestion?.path).toBe(path);
    expect(decision.suggestion?.title).toBe('Water the plants');
    expect(decision.suggestion?.tags).toEqual(['home', 'plants']);
  });

  it('decides new when the matcher says new', async () => {
    await seedNote(makeNote());
    const decision = await matchNote(makeNote(), db, settings, newOnlyMatcher);
    expect(decision.kind).toBe('new');
    expect(decision.suggestion).toBeUndefined();
  });

  it('decides new when there are no existing Notes (no matcher call)', async () => {
    const calls: unknown[] = [];
    const matcher: Matcher = { match: async () => { calls.push(1); return { kind: 'new' }; } };
    const decision = await matchNote(makeNote(), db, settings, matcher);
    expect(decision.kind).toBe('new');
    expect(calls).toHaveLength(0); // empty managed folder → no matcher round-trip
  });

  it('falls back to new when the matcher suggests an unknown Note path', async () => {
    await seedNote(makeNote());
    const bogus: Matcher = { match: async () => ({ kind: 'append', path: 'Brain Dump/nope.md' }) };
    const decision = await matchNote(makeNote(), db, settings, bogus);
    expect(decision.kind).toBe('new');
  });
});

// --- append + edit preservation + 409 retry ------------------------------

describe('appendDumpToNote (Seam A — ticket 04)', () => {
  it('adds a new dated section to the Note body', async () => {
    const path = await seedNote(makeNote({ body: 'Original organized body.' }));
    const appended = makeNote({ body: 'A second thought about the plants.' });

    const written: WriteResult = await appendDumpToNote(appended, path, {
      db,
      settings,
      hash: sha1Hex,
      now: () => fixedNow,
    });

    expect(written.path).toBe(path);
    const content = await noteContent(path);
    // The original body and the new dated section are both present.
    expect(content).toContain('Original organized body.');
    expect(content).toContain('## Appended 2026-08-21 20:30:45 UTC');
    expect(content).toContain('A second thought about the plants.');
    // The section traces back to its source Dump.
    expect(content).toContain(`_Source: ${appended.source}_`);
    // The appended section comes after the original body (chronological append).
    expect(content.indexOf('Original organized body.')).toBeLessThan(
      content.indexOf('## Appended 2026-08-21 20:30:45 UTC'),
    );
  });

  it('never overwrites the user’s existing edits to the Note body', async () => {
    const path = await seedNote(makeNote({ body: 'Original body.' }));
    // The user edits the Note in Obsidian — a hand-written line in the body.
    await directAppendLine(db, settings, path, 'A hand-written edit by the user.');

    await appendDumpToNote(makeNote({ body: 'New dump body.' }), path, {
      db,
      settings,
      hash: sha1Hex,
      now: () => fixedNow,
    });

    const content = await noteContent(path);
    expect(content).toContain('Original body.');
    expect(content).toContain('A hand-written edit by the user.'); // the edit survived
    expect(content).toContain('New dump body.');
  });

  it('does not refresh the Note metadata — frontmatter (title/tags/summary) is unchanged', async () => {
    const path = await seedNote(
      makeNote({ title: 'Original Title', tags: ['keepme'], summary: 'Original summary.', body: 'Body.' }),
    );
    // The appended dump organizes to a different title/tags/summary — but the append
    // must NOT re-derive the existing Note's frontmatter (refresh is explicit).
    await appendDumpToNote(
      makeNote({ title: 'Different Title', tags: ['different'], summary: 'Different summary.', body: 'New body.' }),
      path,
      { db, settings, hash: sha1Hex, now: () => fixedNow },
    );

    const content = await noteContent(path);
    expect(content).toContain('title: Original Title'); // unchanged
    expect(content).toContain('tags: [keepme]'); // unchanged
    expect(content).toContain('summary: Original summary.'); // unchanged
    expect(content).not.toContain('title: Different Title');
    expect(content).toContain('New body.'); // only the body gained a section
  });

  it('retries on a 409 conflict: re-fetches, re-applies the append, preserves the concurrent edit', async () => {
    const path = await seedNote(makeNote({ body: 'Original body.' }));
    const noteMetaId = docIdForPath(path, settings);

    // A DocStore whose first metadata-replace put 409s — simulating a concurrent edit
    // landing between our read and our write. On that conflict, the concurrent edit is
    // written directly to the underlying db (a user edit to the body + a bumped _rev).
    let conflicted = false;
    const conflictingDb: DocStore = {
      put: async (doc) => {
        const isMetaReplace =
          (doc as { _id?: string; type?: string; _rev?: string })._id === noteMetaId &&
          (doc as { type?: string }).type === 'plain' &&
          !!(doc as { _rev?: string })._rev;
        if (isMetaReplace && !conflicted) {
          conflicted = true;
          await directAppendLine(db, settings, path, 'Concurrent user edit.'); // concurrent edit lands
          const err = new Error('conflict');
          (err as unknown as { status: number }).status = 409;
          (err as unknown as { name: string }).name = 'conflict';
          throw err;
        }
        return db.put(doc);
      },
      get: (id: string) => db.get(id),
      allDocs: (opts?: { include_docs?: boolean }) => db.allDocs(opts),
    };

    await appendDumpToNote(makeNote({ body: 'New dump body.' }), path, {
      db: conflictingDb,
      settings,
      hash: sha1Hex,
      now: () => fixedNow,
    });

    const content = await noteContent(path);
    // The concurrent edit survived (not clobbered)…
    expect(content).toContain('Concurrent user edit.');
    // …and the append was re-applied to the fresh content.
    expect(content).toContain('Original body.');
    expect(content).toContain('## Appended 2026-08-21 20:30:45 UTC');
    expect(content).toContain('New dump body.');
    expect(conflicted).toBe(true); // proves the retry path actually ran
  });

  it('throws after exhausting conflict retries', async () => {
    const path = await seedNote(makeNote({ body: 'Original body.' }));
    const noteMetaId = docIdForPath(path, settings);

    // Every metadata-replace put 409s — the conflict never resolves.
    const alwaysConflictDb: DocStore = {
      put: async (doc) => {
        if ((doc as { _id?: string })._id === noteMetaId && (doc as { type?: string }).type === 'plain' && (doc as { _rev?: string })._rev) {
          const err = new Error('conflict');
          (err as unknown as { status: number }).status = 409;
          (err as unknown as { name: string }).name = 'conflict';
          throw err;
        }
        return db.put(doc);
      },
      get: (id: string) => db.get(id),
      allDocs: (opts?: { include_docs?: boolean }) => db.allDocs(opts),
    };

    await expect(
      appendDumpToNote(makeNote({ body: 'New dump body.' }), path, {
        db: alwaysConflictDb,
        settings,
        hash: sha1Hex,
        now: () => fixedNow,
      }),
    ).rejects.toThrow(/exceeded/);
  });
});

// --- capture composition: match + confirm --------------------------------

describe('capture composition (Seam A — ticket 04)', () => {
  it('begins a session matched to an existing Note, and finalizing appends to it', async () => {
    const existingPath = await seedNote(makeNote({ body: 'Existing note body.' }));

    const beginDeps = {
      db,
      settings,
      organizer,
      matcher: appendToFirstMatcher,
      now: () => fixedNow,
      newId: () => 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee',
      hash: sha1Hex,
    };

    const session = await beginCapture('I keep forgetting to water the plants', beginDeps);

    // The match-and-confirm: the new Dump is matched to the existing Note.
    expect(session.match.kind).toBe('append');
    expect(session.match.suggestion?.path).toBe(existingPath);
    expect(session.preview.title).toBe('Water the plants'); // the initial Organize preview is shown
    expect(session.saved).toBe(false);

    // The user confirms append — finalizing adds a dated section instead of founding a new Note.
    const result = await finalizeCapture(session, {
      db,
      settings,
      organizer,
      hash: sha1Hex,
      now: () => fixedNow,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.saved).toBe(true);
    expect(result.written.path).toBe(existingPath); // appended in place — no new Note file

    const content = await noteContent(existingPath);
    expect(content).toContain('Existing note body.');
    expect(content).toContain('## Appended 2026-08-21 20:30:45 UTC');
    // No second Note was founded in the managed folder.
    const all = await db.allDocs({ include_docs: true });
    const managedNotes = all.rows.filter(
      (r) => (r.doc as { type?: string; path?: string })?.type === 'plain' &&
        (r.doc as { path?: string }).path?.startsWith(`${settings.managedFolder}/`),
    );
    expect(managedNotes).toHaveLength(1);
  });

  it('a new decision founds a new Note (no append)', async () => {
    const beginDeps = {
      db,
      settings,
      organizer,
      matcher: newOnlyMatcher,
      now: () => fixedNow,
      newId: () => 'cccccccc-cccc-cccc-dddd-eeeeeeeeeeee',
      hash: sha1Hex,
    };
    const session = await beginCapture('a brand new thought', beginDeps);
    expect(session.match.kind).toBe('new');

    const result = await finalizeCapture(session, {
      db,
      settings,
      organizer,
      hash: sha1Hex,
      now: () => fixedNow,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.written.path.startsWith(`${settings.managedFolder}/`)).toBe(true);
  });

  it('the user declines the append suggestion — overriding to new founds a fresh Note', async () => {
    const existingPath = await seedNote(makeNote({ title: 'Plants care log', body: 'Existing note body.' }));

    const session = await beginCapture('I keep forgetting to water the plants', {
      db,
      settings,
      organizer,
      matcher: appendToFirstMatcher,
      now: () => fixedNow,
      newId: () => 'dddddddd-dddd-cccc-dddd-eeeeeeeeeeee',
      hash: sha1Hex,
    });
    expect(session.match.kind).toBe('append'); // suggested append…

    // …but the user overrides to a new Note (the one-tap "Save as new Note" action).
    const declined: typeof session = { ...session, match: { kind: 'new' } };
    const result = await finalizeCapture(declined, {
      db,
      settings,
      organizer,
      hash: sha1Hex,
      now: () => fixedNow,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A new Note file is founded, distinct from the suggested existing Note…
    expect(result.written.path).not.toBe(existingPath);
    expect(result.written.path.startsWith(`${settings.managedFolder}/`)).toBe(true);
    // …and the existing Note is untouched (no dated section appended to it).
    const content = await noteContent(existingPath);
    expect(content).not.toContain('## Appended');
    expect(content).toContain('Existing note body.');
  });
});

// --- explicit metadata refresh ------------------------------------------

describe('refreshNoteMetadata (Seam A — ticket 04)', () => {
  it('re-derives frontmatter from the body while preserving the body byte-for-byte', async () => {
    const path = await seedNote(
      makeNote({ title: 'Old Title', tags: ['old'], category: 'uncategorized', summary: 'Old summary.', body: 'The body the user may have edited.' }),
    );

    const refreshOrganizer: Organizer = {
      organize: async () => ({ ...sampleOutput, title: 'New Title', tags: ['new'], category: 'personal', summary: 'New summary.' }),
    };

    await refreshNoteMetadata(path, {
      db,
      settings,
      organizer: refreshOrganizer,
      hash: sha1Hex,
      now: () => fixedNow,
    });

    const content = await noteContent(path);
    // Frontmatter re-derived…
    expect(content).toContain('title: New Title');
    expect(content).toContain('tags: [new]');
    expect(content).toContain('category: personal');
    expect(content).toContain('summary: New summary.');
    expect(content).not.toContain('title: Old Title');
    // …but the body is preserved (the user's edits are never overwritten by a refresh).
    expect(content).toContain('The body the user may have edited.');
  });

  it('organizes once even when a 409 forces a retry (not once per retry)', async () => {
    const path = await seedNote(makeNote({ title: 'Old Title', body: 'The body.' }));
    const noteMetaId = docIdForPath(path, settings);

    let organizeCalls = 0;
    const countingOrganizer: Organizer = {
      organize: async () => {
        organizeCalls += 1;
        return { ...sampleOutput, title: 'New Title', tags: ['new'], category: 'personal', summary: 'New summary.' };
      },
    };

    // First metadata-replace put 409s (a concurrent edit lands), then it succeeds.
    let conflicted = false;
    const conflictingDb: DocStore = {
      put: async (doc) => {
        if ((doc as { _id?: string })._id === noteMetaId && (doc as { type?: string }).type === 'plain' && (doc as { _rev?: string })._rev) {
          if (!conflicted) {
            conflicted = true;
            await directAppendLine(db, settings, path, 'Concurrent edit.');
            const err = new Error('conflict');
            (err as unknown as { status: number }).status = 409;
            (err as unknown as { name: string }).name = 'conflict';
            throw err;
          }
        }
        return db.put(doc);
      },
      get: (id: string) => db.get(id),
      allDocs: (opts?: { include_docs?: boolean }) => db.allDocs(opts),
    };

    await refreshNoteMetadata(path, {
      db: conflictingDb,
      settings,
      organizer: countingOrganizer,
      hash: sha1Hex,
      now: () => fixedNow,
    });

    // One Organize per user action — the retry re-applies the cached frontmatter.
    expect(organizeCalls).toBe(1);
    expect(conflicted).toBe(true); // the retry path actually ran
    const content = await noteContent(path);
    expect(content).toContain('title: New Title'); // re-derived frontmatter applied
    expect(content).toContain('Concurrent edit.'); // the concurrent body edit survived
    expect(content).toContain('The body.');
  });
});

// --- internals shared with the test (a direct body append, bypassing the
// operation layer so the 409-retry test can simulate a concurrent edit). ---

/** Append a raw line to a Note's body directly against the underlying db, bumping
 *  the metadata `_rev` — used to simulate a concurrent Obsidian edit. */
async function directAppendLine(
  rawDb: DocStore,
  s: Settings,
  path: string,
  line: string,
): Promise<void> {
  const metadataId = docIdForPath(path, s);
  const meta = await rawDb.get<Record<string, unknown> & { _rev: string; children: string[] }>(metadataId);
  const chunk = await rawDb.get<{ data: string }>(meta.children[0]);
  const newContent = `${chunk.data.trimEnd()}\n\n${line}\n`;
  const newChunkId = 'h:' + (await sha1Hex(newContent));
  await rawDb.put({ _id: newChunkId, type: 'leaf', data: newContent });
  await rawDb.put({ ...meta, children: [newChunkId], mtime: meta.mtime, size: newContent.length });
}
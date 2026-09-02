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
  writeDump,
  matchNote,
  beginCapture,
  settleMatch,
  finalizeCapture,
  parseNote,
  refreshNoteMetadata,
  wikilink,
  type WriteResult,
} from '../src/lib/operations';
import { docIdForPath } from '../src/lib/livesync';
import {
  DEFAULT_SETTINGS,
  type Settings,
  type DocStore,
  type Dump,
  type Embedder,
  type Note,
  type Organizer,
  type Relater,
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

// Capture-latency ticket 03: beginCapture leaves the match undecided and the app settles
// it behind the preview. These suites are about the append path, not the decision's
// timing (pinned in operations.test.ts), so they settle immediately with the matcher
// under test — same protocol the app follows.
async function beginAndSettle(text: string, deps: Parameters<typeof beginCapture>[1]) {
  return settleMatch(await beginCapture(text, deps), {
    db: deps.db,
    settings: deps.settings,
    matcher: deps.matcher,
  });
}

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

/** An Organizer that records what it was asked to organize — the accumulated-Dump
 *  assertions read its calls. */
function recordingOrganizer(output: Partial<OrganizeOutput> = {}) {
  const calls: Array<{ content: string; modality: Modality }> = [];
  return {
    calls,
    organizer: {
      organize: async (content: string, modality: Modality) => {
        calls.push({ content, modality });
        return { ...sampleOutput, ...output };
      },
    },
  };
}

/** Seed the Dump file a seeded Note's `source` wikilink points at: the default ids and
 *  capture time line up (`dumpFilename` = <stamp>-<first 6 id chars>.md), so the Note's
 *  default `source` resolves to the returned path. */
async function seedDump(over: Partial<Dump> = {}): Promise<string> {
  const dump: Dump = {
    id: 'aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    content: 'First verbatim capture.',
    context: '',
    createdAt: fixedNow,
    modality: 'text' as Modality,
    ...over,
  };
  const written = await writeDump(dump, { db, settings, hash: sha1Hex });
  return written.path;
}

// --- the append rework (ADR-0009, Seam A) ---------------------------------

describe('finalizeCapture — the append rework (ADR-0009, Seam A)', () => {
  it('merges the capture into the target Dump, then re-organizes the Note wholesale from it', async () => {
    // ADR-0009: the Note is always the Organize of its entire Dump. Append writes the new
    // capture into the target's one Dump as a dated verbatim section (the point of
    // durability), then one Organize call regenerates the Note — body and title alike —
    // from the accumulated Dump, written back at the frozen path.
    const dumpPath = await seedDump();
    const existingPath = await seedNote(
      makeNote({ source: wikilink(dumpPath), body: 'Old organized body.', title: 'Old Title' }),
    );

    const { calls, organizer: reorganizer } = recordingOrganizer({
      title: 'Plants, revisited',
      body: 'The whole thought, re-organized.',
    });

    const session = await beginAndSettle('Second verbatim capture.', {
      db,
      settings,
      organizer: reorganizer,
      matcher: appendToFirstMatcher,
      now: () => fixedNow + 1000,
      newId: () => 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee',
      hash: sha1Hex,
    });
    expect(session.match.kind).toBe('append');

    const result = await finalizeCapture(session, {
      db,
      settings,
      organizer: reorganizer,
      hash: sha1Hex,
      now: () => fixedNow + 2000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The filename is frozen at creation — a rewritten title does not move the file.
    expect(result.written.path).toBe(existingPath);

    // The capture was merged into the target's one Dump: original intact, new capture
    // verbatim under a dated section stamped with the *capture's* time.
    const dumpContent = await noteContent(dumpPath);
    expect(dumpContent).toContain('First verbatim capture.');
    expect(dumpContent).toContain('## Appended 2026-08-21 20:30:46 UTC');
    expect(dumpContent).toContain('Second verbatim capture.');

    // Exactly one Organize over the accumulated Dump (the first call is the preview's).
    expect(calls).toHaveLength(2);
    expect(calls[1].content).toContain('First verbatim capture.');
    expect(calls[1].content).toContain('Second verbatim capture.');
    expect(calls[1].content).toContain('## Appended');

    // The Note file is the organizer's output — the old body and frontmatter are gone,
    // the new Note written in their place at the same path.
    const content = await noteContent(existingPath);
    expect(content).toContain('title: Plants, revisited');
    expect(content).toContain('The whole thought, re-organized.');
    expect(content).not.toContain('Old organized body.');
    expect(content).not.toContain('title: Old Title');
    // The single source wikilink survives: the Note still points at its one Dump.
    expect(content).toContain(`source: ${wikilink(dumpPath)}`);
  });

  it('Related is recomputed on the append path and points only at Notes that exist (finding 07)', async () => {
    // Finding 07: an Append's Related links were computed and then discarded. Here they are
    // written into the re-organized Note — recomputed for the Note as it now stands, from
    // documents that actually exist in the Vault.
    const dumpPath = await seedDump();
    const existingPath = await seedNote(makeNote({ source: wikilink(dumpPath) }));
    // Two candidate documents: one genuinely close to the re-organized Note, one not.
    await seedNote(makeNote({ title: 'The basil window box', body: 'Basil needs water too.', source: '[[_dumps/20260821-203045-cccccc]]' }));

    const embedder: Embedder = {
      embed: async (texts) =>
        texts.map((t) => (t.toLowerCase().includes('plants') ? [1] : [0])),
    };
    const judged: string[][] = [];
    const relater: Relater = {
      related: async (_subject, candidates) => {
        judged.push(candidates.map((c) => c.path));
        return candidates.map((_, i) => i); // accept every shortlisted candidate
      },
    };

    const session = await beginAndSettle('Second verbatim capture.', {
      db,
      settings,
      organizer,
      matcher: appendToFirstMatcher,
      now: () => fixedNow + 1000,
      newId: () => 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee',
      hash: sha1Hex,
    });
    const result = await finalizeCapture(session, {
      db,
      settings,
      organizer,
      embedder,
      relater,
      hash: sha1Hex,
      now: () => fixedNow + 2000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The judge saw the basil Note (similar enough to shortlist) but never the target itself…
    expect(judged.length).toBeGreaterThan(0);
    for (const candidates of judged) {
      expect(candidates).not.toContain(existingPath);
    }
    // …and the rewritten Note carries the resolved links in its Related section.
    const content = await noteContent(existingPath);
    expect(content).toContain('- [[Brain Dump/2026-08-21-the-basil-window-box]]');
    // The organizer's own `related` output is not what landed — the judge's is.
    expect(content).not.toContain('- [[plants]]');
  });

  it('founding a new Note is unchanged — the preview is reused when no Context was added', async () => {
    const { calls, organizer: reorganizer } = recordingOrganizer();
    const session = await beginAndSettle('a brand new thought', {
      db,
      settings,
      organizer: reorganizer,
      matcher: newOnlyMatcher,
      now: () => fixedNow,
      newId: () => 'cccccccc-cccc-cccc-dddd-eeeeeeeeeeee',
      hash: sha1Hex,
    });
    const result = await finalizeCapture(session, {
      db,
      settings,
      organizer: reorganizer,
      hash: sha1Hex,
      now: () => fixedNow,
    });
    expect(result.ok).toBe(true);
    // One Organize total — the preview call. Finalize reuses it (no Context added).
    expect(calls).toHaveLength(1);
    if (!result.ok) return;
    expect(result.written.path.startsWith(`${settings.managedFolder}/`)).toBe(true);
  });
});

describe('matchNote (Seam A — ticket 04)', () => {
  it('suggests append to the matched existing Note (LLM-assisted, by tags/topic)', async () => {
    const path = await seedNote(makeNote());

    const decision = await matchNote(makeNote(), db, settings, appendToFirstMatcher);

    expect(decision.kind).toBe('append');
    if (decision.kind !== 'append') return; // narrow the union for the type checker
    expect(decision.suggestion?.path).toBe(path);
    expect(decision.suggestion?.title).toBe('Water the plants');
    expect(decision.suggestion?.tags).toEqual(['home', 'plants']);
  });

  it('decides new when the matcher says new', async () => {
    await seedNote(makeNote());
    const decision = await matchNote(makeNote(), db, settings, newOnlyMatcher);
    expect(decision.kind).toBe('new');
    expect('suggestion' in decision).toBe(false);
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

// --- the append's failure semantics (ADR-0009, Seam A) --------------------

describe('finalizeCapture — append failure semantics (ADR-0009, Seam A)', () => {
  it('a failing Organize leaves the old Note untouched; the merged Dump is saved for the retry', async () => {
    const dumpPath = await seedDump();
    const existingPath = await seedNote(
      makeNote({ source: wikilink(dumpPath), body: 'Old organized body.', title: 'Old Title' }),
    );

    let calls = 0;
    const failingOrganizer: Organizer = {
      organize: async () => {
        calls += 1;
        if (calls > 1) throw new Error('provider down'); // the preview succeeds; the append's Organize fails
        return sampleOutput;
      },
    };

    const session = await beginAndSettle('Second verbatim capture.', {
      db,
      settings,
      organizer: failingOrganizer,
      matcher: appendToFirstMatcher,
      now: () => fixedNow + 1000,
      newId: () => 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee',
      hash: sha1Hex,
    });

    const result = await finalizeCapture(session, {
      db,
      settings,
      organizer: failingOrganizer,
      hash: sha1Hex,
      now: () => fixedNow + 2000,
    });
    expect(result.ok).toBe(false);

    // The old Note is exactly as it was — a failed Organize never writes a half-organized Note.
    const content = await noteContent(existingPath);
    expect(content).toContain('title: Old Title');
    expect(content).toContain('Old organized body.');
    expect(content).not.toContain('The whole thought');

    // The merge is the point of durability: the capture is already in the target Dump.
    const dumpContent = await noteContent(dumpPath);
    expect(dumpContent).toContain('Second verbatim capture.');
    expect(dumpContent).toContain('## Appended 2026-08-21 20:30:46 UTC');
  });

  it('retrying after a mid-flight failure re-organizes without duplicating the merged section', async () => {
    const dumpPath = await seedDump();
    await seedNote(makeNote({ source: wikilink(dumpPath), body: 'Old organized body.' }));

    let calls = 0;
    const flakyOrganizer: Organizer = {
      organize: async (content) => {
        calls += 1;
        if (calls === 1) return sampleOutput; // the preview
        if (calls === 2) throw new Error('provider down'); // the first append attempt
        expect(content).toContain('Second verbatim capture.'); // retry organizes the accumulated Dump
        return { ...sampleOutput, body: 'Recovered, re-organized.' };
      },
    };

    const session = await beginAndSettle('Second verbatim capture.', {
      db,
      settings,
      organizer: flakyOrganizer,
      matcher: appendToFirstMatcher,
      now: () => fixedNow + 1000,
      newId: () => 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee',
      hash: sha1Hex,
    });

    const first = await finalizeCapture(session, {
      db, settings, organizer: flakyOrganizer, hash: sha1Hex, now: () => fixedNow + 2000,
    });
    expect(first.ok).toBe(false);
    if (first.ok) return;

    // The retry is a fresh finalize of the same (unsaved) session — the Dump already holds
    // the merged capture, so it must not be merged a second time.
    const retry = await finalizeCapture(first.session, {
      db, settings, organizer: flakyOrganizer, hash: sha1Hex, now: () => fixedNow + 3000,
    });
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;

    const dumpContent = await noteContent(dumpPath);
    expect(dumpContent.match(/## Appended 2026-08-21 20:30:46 UTC/g)).toHaveLength(1);
    expect(dumpContent.match(/Second verbatim capture\./g)).toHaveLength(1);
  });

  it('a 409 on the Note rewrite retries and writes the organized Note — the Note is a view, so a concurrent hand edit is regenerated over', async () => {
    const dumpPath = await seedDump();
    const path = await seedNote(makeNote({ source: wikilink(dumpPath), body: 'Old organized body.' }));
    const noteMetaId = docIdForPath(path, settings);

    let conflicted = false;
    const conflictingDb: DocStore = {
      put: async (doc) => {
        if ((doc as { _id?: string })._id === noteMetaId && (doc as { type?: string }).type === 'plain' && (doc as { _rev?: string })._rev) {
          if (!conflicted) {
            conflicted = true;
            await directAppendLine(db, settings, path, 'Concurrent user edit.');
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

    const session = await beginAndSettle('Second verbatim capture.', {
      db: conflictingDb,
      settings,
      organizer,
      matcher: appendToFirstMatcher,
      now: () => fixedNow + 1000,
      newId: () => 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee',
      hash: sha1Hex,
    });
    const result = await finalizeCapture(session, {
      db: conflictingDb, settings, organizer, hash: sha1Hex, now: () => fixedNow + 2000,
    });
    expect(result.ok).toBe(true);
    expect(conflicted).toBe(true); // the retry path actually ran

    const content = await noteContent(path);
    // The organized Note won: the Note is regenerated from the Dump on every Organize.
    expect(content).toContain('I keep forgetting to water the plants.');
    expect(content).not.toContain('Old organized body.');
    // The Dump is the record — a concurrent edit to the *Dump* would have survived the
    // retry (the merge re-applies to fresh content). The Note itself is a view.
  });

  it('when the target Note has no readable Dump, the capture founds a new Note instead', async () => {
    // A Note whose source Dump was deleted: nothing to merge into, and the capture
    // must still file.
    await seedNote(makeNote({ body: 'Dump-less note.' }));

    const session = await beginAndSettle('a thought with nowhere to merge', {
      db,
      settings,
      organizer,
      matcher: appendToFirstMatcher,
      now: () => fixedNow,
      newId: () => 'eeeeeeee-eeee-cccc-dddd-eeeeeeeeeeee',
      hash: sha1Hex,
    });
    expect(session.match.kind).toBe('append');

    const result = await finalizeCapture(session, {
      db, settings, organizer, hash: sha1Hex, now: () => fixedNow,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Founded fresh rather than failing — the thought is filed.
    expect(result.written.path.startsWith(`${settings.managedFolder}/`)).toBe(true);
    expect(result.note.source).toContain('_dumps/');
  });
});

// --- capture composition: match + confirm --------------------------------

describe('capture composition (Seam A — ticket 04)', () => {
  it('begins a session matched to an existing Note, and finalizing appends to it', async () => {
    const dumpPath = await seedDump();
    const existingPath = await seedNote(makeNote({ source: wikilink(dumpPath) }));

    const beginDeps = {
      db,
      settings,
      organizer,
      matcher: appendToFirstMatcher,
      now: () => fixedNow,
      newId: () => 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee',
      hash: sha1Hex,
    };

    const session = await beginAndSettle('I keep forgetting to water the plants', beginDeps);

    // The match-and-confirm: the new Dump is matched to the existing Note.
    expect(session.match.kind).toBe('append');
    if (session.match.kind !== 'append') return; // narrow the union for the type checker
    expect(session.match.suggestion?.path).toBe(existingPath);
    expect(session.preview.title).toBe('Water the plants'); // the initial Organize preview is shown
    expect(session.saved).toBe(false);

    // The user confirms append — finalizing merges into the target's one Dump and
    // re-organizes the Note in place instead of founding a new one.
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

    // The capture joined the target's Dump, and the Note was rewritten from it.
    const dumpContent = await noteContent(dumpPath);
    expect(dumpContent).toContain('## Appended');
    expect(dumpContent).toContain('I keep forgetting to water the plants');
    const content = await noteContent(existingPath);
    expect(content).toContain(`source: ${wikilink(dumpPath)}`); // still the one Dump
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
    const session = await beginAndSettle('a brand new thought', beginDeps);
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

    const session = await beginAndSettle('I keep forgetting to water the plants', {
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

// --- explicit Re-organize (ADR-0009: the same path as an append, minus the merge) ---

describe('refreshNoteMetadata (Seam A — the append rework)', () => {
  it('re-organizes the Note wholesale from its Dump — title and body alike, hand edits do not survive', async () => {
    const dumpPath = await seedDump();
    const path = await seedNote(makeNote({ source: wikilink(dumpPath), title: 'Old Title' }));
    // The user hand-edited the Note after it was filed — provisional, per the glossary:
    // it lasts until the next Organize.
    await directAppendLine(db, settings, path, 'A hand-written edit by the user.');

    const { calls, organizer: refreshOrganizer } = recordingOrganizer({
      title: 'Plant care, the whole log',
      body: 'Regenerated from the accumulated Dump.',
    });

    await refreshNoteMetadata(path, {
      db,
      settings,
      organizer: refreshOrganizer,
      hash: sha1Hex,
      now: () => fixedNow,
    });

    // The Organize ran against the accumulated Dump — the record, not the view.
    expect(calls).toHaveLength(1);
    expect(calls[0].content).toContain('First verbatim capture.');

    const content = await noteContent(path);
    // Body and title regenerated wholesale…
    expect(content).toContain('title: Plant care, the whole log');
    expect(content).toContain('Regenerated from the accumulated Dump.');
    // …the hand edit did not survive (the Note is a view; the Dump is the record)…
    expect(content).not.toContain('A hand-written edit by the user.');
    // …and identity survives: the frozen filename, the source link, the original date.
    expect(content).toContain(`source: ${wikilink(dumpPath)}`);
    expect(content).toContain(`created: ${fixedNow}`);
  });

  it('when the Note\'s Dump is gone, the body on the file is preserved and only the frontmatter is re-derived', async () => {
    // No dump file seeded — the Note's `source` points at a Dump that does not exist.
    const path = await seedNote(
      makeNote({ title: 'Old Title', summary: 'Old summary.', body: 'The body that remains.' }),
    );

    const { organizer: refreshOrganizer } = recordingOrganizer({
      title: 'New Title', summary: 'New summary.',
    });

    await refreshNoteMetadata(path, {
      db,
      settings,
      organizer: refreshOrganizer,
      hash: sha1Hex,
      now: () => fixedNow,
    });

    const content = await noteContent(path);
    expect(content).toContain('title: New Title'); // frontmatter re-derived…
    expect(content).toContain('summary: New summary.');
    expect(content).toContain('The body that remains.'); // …and the body preserved.
  });

  it('organizes once even when a 409 forces a retry (not once per retry)', async () => {
    const dumpPath = await seedDump();
    const path = await seedNote(makeNote({ source: wikilink(dumpPath), title: 'Old Title' }));
    const noteMetaId = docIdForPath(path, settings);

    const { calls, organizer: countingOrganizer } = recordingOrganizer({
      title: 'New Title',
 body: 'Regenerated.',
    });

    // First metadata-replace put 409s (a concurrent hand edit lands), then it succeeds.
    let conflicted = false;
    const conflictingDb: DocStore = {
      put: async (doc) => {
        if ((doc as { _id?: string })._id === noteMetaId && (doc as { type?: string }).type === 'plain' && (doc as { _rev?: string })._rev) {
          if (!conflicted) {
            conflicted = true;
            await directAppendLine(db, settings, path, 'Concurrent hand edit.');
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

    // One Organize per user action — the rebuilt file is computed once and re-applied.
    expect(calls).toHaveLength(1);
    expect(conflicted).toBe(true); // the retry path actually ran
    const content = await noteContent(path);
    expect(content).toContain('title: New Title');
    expect(content).toContain('Regenerated.');
    // The Note is a view: the concurrent hand edit is regenerated over, not preserved.
    expect(content).not.toContain('Concurrent hand edit.');
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
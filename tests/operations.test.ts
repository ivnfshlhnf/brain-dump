// Seam A — application operations, tested as black boxes.
// CouchDB is an in-memory PouchDB; the LLM/embedder is irrelevant to capture (no LLM in ticket 01).
import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import PouchDB from 'pouchdb-core';
import memory from 'pouchdb-adapter-memory';
import { capture, organizeDump, beginCapture, settleMatch, addContext, finalizeCapture, dumpFilename, writeNote } from '../src/lib/operations';
import { docIdForPath, writeFile } from '../src/lib/livesync';
import {
  DEFAULT_SETTINGS,
  type Settings,
  type DocStore,
  type Dump,
  type Organizer,
  type OrganizeOutput,
  type Modality,
  type Matcher,
} from '../src/lib/types';

PouchDB.plugin(memory);

// Ticket 04: beginCapture now matches the preview against existing Notes. The
// ticket-03 flow expects a 'new' decision, so these tests pass a matcher that
// always suggests new (the matching behaviour itself is covered in append.test.ts).
const newOnlyMatcher: Matcher = { match: async () => ({ kind: 'new' }) };

function sha1Hex(content: string): Promise<string> {
  return Promise.resolve(createHash('sha1').update(content).digest('hex'));
}

const fixedNow = Date.UTC(2026, 7, 21, 20, 30, 45); // 2026-08-21 20:30:45 UTC
const fixedId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const settings: Settings = { ...DEFAULT_SETTINGS, dumpsFolder: '_dumps', managedFolder: 'Brain Dump' };

let db: DocStore;
let seq = 0;

const depsWithId = (id: string) => ({
  db,
  settings,
  now: () => fixedNow,
  newId: () => id,
  hash: sha1Hex,
});

beforeEach(() => {
  // Fresh in-memory DB per test (the memory adapter shares state by name within a process).
  db = new PouchDB('t' + seq++, { adapter: 'memory' }) as unknown as DocStore;
});

describe('capture (Seam A)', () => {
  it('captures a verbatim Dump to _dumps/ as a metadata doc + a content-addressed chunk doc', async () => {
    const result = await capture('I keep forgetting to water the plants', depsWithId(fixedId));

    expect(result.path.startsWith('_dumps/')).toBe(true);

    const meta = await db.get<{ type: string; path: string; children: string[]; eden: object }>(
      result.metadataId,
    );
    expect(meta.type).toBe('plain');
    expect(meta.path).toBe(result.path);
    expect(meta.children).toHaveLength(1);
    expect(meta.eden).toEqual({});

    const chunk = await db.get<{ type: string; data: string; _id: string }>(meta.children[0]);
    expect(chunk.type).toBe('leaf');
    expect(chunk.data).toContain('I keep forgetting to water the plants');
    expect(chunk._id).toBe('h:' + createHash('sha1').update(chunk.data).digest('hex'));
  });

  it('uses a lowercased _id with the /_dumps/ prefix (case-insensitive default)', async () => {
    const result = await capture('a thought', depsWithId(fixedId));
    expect(result.metadataId).toBe('/_dumps/20260821-203045-aaaaaa.md');
  });

  it('preserves the verbatim text inside the dump file', async () => {
    const result = await capture('exact words here 123', depsWithId(fixedId));
    const meta = await db.get<{ children: string[] }>(result.metadataId);
    const chunk = await db.get<{ data: string }>(meta.children[0]);
    expect(chunk.data).toContain('exact words here 123');
  });

  it('rejects an empty brain-dump', async () => {
    await expect(capture('   ', depsWithId(fixedId))).rejects.toThrow();
  });

  it('writeFile deduplicates identical content chunks across different paths', async () => {
    // Two distinct files with identical body content share one content-addressed chunk.
    const opts = { ctime: fixedNow, mtime: fixedNow, hash: sha1Hex, settings };
    const a = await writeFile(db, '_dumps/a.md', 'identical body', opts);
    const b = await writeFile(db, '_dumps/b.md', 'identical body', opts);

    expect(a.chunkId).toBe(b.chunkId);

    const all = await db.allDocs({ include_docs: true });
    const chunks = all.rows.filter((r) => (r.doc as { type?: string })?.type === 'leaf');
    const metas = all.rows.filter((r) => (r.doc as { type?: string })?.type === 'plain');
    expect(chunks).toHaveLength(1);
    expect(metas).toHaveLength(2);
  });

  it('docIdForPath lowercases (case-insensitive) and prefixes underscore-leading folders', () => {
    expect(docIdForPath('_dumps/Foo.md', settings)).toBe('/_dumps/foo.md');
    expect(docIdForPath('Brain Dump/Note.md', settings)).toBe('brain dump/note.md');
  });

  it('docIdForPath preserves case when case-sensitive', () => {
    const cs: Settings = { ...settings, caseSensitive: true };
    expect(docIdForPath('_dumps/Foo.md', cs)).toBe('/_dumps/Foo.md');
    expect(docIdForPath('Brain Dump/Note.md', cs)).toBe('Brain Dump/Note.md');
  });
});

describe('organizeDump (Seam A)', () => {
  // Deterministic Organize fake — no real LLM call. Records what it was asked.
  const sampleOutput: OrganizeOutput = {
    title: 'Water the plants',
    tags: ['home', 'plants'],
    category: 'personal',
    summary: 'A reminder to water the plants.',
    keyPoints: ['Water the plants regularly'],
    related: ['[[plants]]'],
    body: 'I keep forgetting to water the plants.',
  };

  let organizeCalls: Array<{ content: string; modality: Modality }> = [];
  const organizer: Organizer = {
    organize: async (content, modality) => {
      organizeCalls.push({ content, modality });
      return sampleOutput;
    },
  };

  const dump: Dump = {
    id: fixedId,
    content: 'I keep forgetting to water the plants',
    context: '',
    createdAt: fixedNow,
    modality: 'text',
  };

  const deps = (org: Organizer = organizer) => ({ db, settings, organizer: org, hash: sha1Hex });

  beforeEach(() => {
    organizeCalls = [];
  });

  it('organizes a Dump into a Note in the managed folder as a metadata doc + a content-addressed chunk doc', async () => {
    const result = await organizeDump(dump, deps());

    expect(result.path).toBe('Brain Dump/2026-08-21-water-the-plants.md');
    expect(result.metadataId).toBe('brain dump/2026-08-21-water-the-plants.md');

    const meta = await db.get<{ type: string; path: string; children: string[]; eden: object }>(
      result.metadataId,
    );
    expect(meta.type).toBe('plain');
    expect(meta.path).toBe(result.path); // original case preserved
    expect(meta.children).toHaveLength(1);
    expect(meta.eden).toEqual({});

    const chunk = await db.get<{ type: string; data: string; _id: string }>(meta.children[0]);
    expect(chunk.type).toBe('leaf');
    expect(chunk._id).toBe('h:' + createHash('sha1').update(chunk.data).digest('hex'));
  });

  it('writes the v1 frontmatter schema and Summary/Key points/Related body sections', async () => {
    const result = await organizeDump(dump, deps());
    const meta = await db.get<{ children: string[] }>(result.metadataId);
    const chunk = await db.get<{ data: string }>(meta.children[0]);
    const file = chunk.data;

    // v1 frontmatter schema (type shape from the design session).
    expect(file).toContain('title: Water the plants');
    expect(file).toContain('tags: [home, plants]');
    expect(file).toContain(`created: ${fixedNow}`);
    expect(file).toContain('modality: text');
    expect(file).toContain('category: personal');
    expect(file).toContain('summary: A reminder to water the plants.');
    // Body is the cleaned content, then the structured sections.
    expect(file).toContain('I keep forgetting to water the plants.');
    expect(file).toContain('## Summary');
    expect(file).toContain('## Key points');
    expect(file).toContain('- Water the plants regularly');
    expect(file).toContain('## Related');
    expect(file).toContain('- [[plants]]');
  });

  it('links back to the source Dump via an Obsidian wikilink', async () => {
    const result = await organizeDump(dump, deps());
    const meta = await db.get<{ children: string[] }>(result.metadataId);
    const chunk = await db.get<{ data: string }>(meta.children[0]);
    // source is a wikilink to the source Dump, by vault path without extension.
    expect(chunk.data).toContain('source: [[_dumps/20260821-203045-aaaaaa]]');
    expect(result.note.source).toBe('[[_dumps/20260821-203045-aaaaaa]]');
  });

  it('uses the <YYYY-MM-DD>-<title-slug>.md filename, slugifying the organized title', async () => {
    // Edge cases (special chars, stray hyphens) are exercised through the operation,
    // not by unit-testing the slug helper directly (spec: test via the operation layer).
    const fussy: Organizer = {
      organize: async () => ({ ...sampleOutput, title: '  What?! A thought...  ' }),
    };
    const result = await organizeDump(dump, deps(fussy));
    expect(result.path).toBe('Brain Dump/2026-08-21-what-a-thought.md');
  });

  it('calls the organizer with the dump content and modality, not a real LLM', async () => {
    await organizeDump(dump, deps());
    expect(organizeCalls).toHaveLength(1);
    expect(organizeCalls[0].content).toBe('I keep forgetting to water the plants');
    expect(organizeCalls[0].modality).toBe('text');
  });
});

// Seam A — capture review flow (ticket 03): Note preview, Context, autosave/freeze.
// Drives beginCapture → addContext → finalizeCapture as black boxes. The Organizer
// is a deterministic fake; CouchDB is the in-memory PouchDB stand-in shared above.
describe('capture review flow (Seam A — ticket 03)', () => {
  const sampleOutput: OrganizeOutput = {
    title: 'Water the plants',
    tags: ['home', 'plants'],
    category: 'personal',
    summary: 'A reminder to water the plants.',
    keyPoints: ['Water the plants regularly'],
    related: ['[[plants]]'],
    body: 'I keep forgetting to water the plants.',
  };

  let organizeCalls: Array<{ content: string; modality: Modality }>;
  let organizer: Organizer;

  beforeEach(() => {
    organizeCalls = [];
    // The final Organize (over the full Dump) reflects the added Context, so the
    // final Note's title differs from the preview — proving a re-organize ran.
    organizer = {
      organize: async (content, modality) => {
        organizeCalls.push({ content, modality });
        return content.includes('## Context')
          ? { ...sampleOutput, title: 'Water the plants (with context)' }
          : sampleOutput;
      },
    };
  });

  const beginDeps = (id: string = fixedId) => ({
    db,
    settings,
    organizer,
    matcher: newOnlyMatcher,
    now: () => fixedNow,
    newId: () => id,
    hash: sha1Hex,
  });
  const contextDeps = () => ({ db, settings, hash: sha1Hex });
  const finalizeDeps = (dbOverride: DocStore = db) => ({
    db: dbOverride,
    settings,
    organizer,
    hash: sha1Hex,
    now: () => fixedNow,
  });

  async function dumpChunk(session: { dump: Dump }): Promise<{ data: string }> {
    const path = `${settings.dumpsFolder}/${dumpFilename(session.dump.createdAt, session.dump.id)}`;
    const meta = await db.get<{ children: string[] }>(docIdForPath(path, settings));
    return db.get<{ data: string }>(meta.children[0]);
  }

  // A DocStore that fails only Note writes (metadata docs whose path is in the
  // managed folder), so the Dump persists but the Note is deferred on save failure.
  function dbThatFailsNoteWrites(inner: DocStore): DocStore {
    return {
      put: async (doc) => {
        const path = (doc as { path?: string }).path;
        if (typeof path === 'string' && path.startsWith(`${settings.managedFolder}/`)) {
          throw new Error('writeNote failed (simulated)');
        }
        return inner.put(doc);
      },
      get: (id: string) => inner.get(id),
      allDocs: (opts?: { include_docs?: boolean }) => inner.allDocs(opts),
    };
  }

  it('begins a session: saves the Dump immediately, runs the initial Organize for a preview, leaves the match to settle', async () => {
    const session = await beginCapture('I keep forgetting to water the plants', beginDeps());

    expect(session.dump.content).toBe('I keep forgetting to water the plants');
    expect(session.dump.context).toBe('');
    // Capture-latency ticket 03: the preview does not wait for the match — the decision
    // arrives behind it, so the session begins explicitly undecided.
    expect(session.match.kind).toBe('undecided');
    expect(session.saved).toBe(false);

    // The Dump is in _dumps/ with the verbatim original preserved in a ## Original section.
    const chunk = await dumpChunk(session);
    expect(chunk.data).toContain('## Original');
    expect(chunk.data).toContain('I keep forgetting to water the plants');

    // The preview is the initial Organize — one LLM call so far, over the bare original.
    expect(session.preview.title).toBe('Water the plants');
    expect(organizeCalls).toHaveLength(1);
    expect(organizeCalls[0].content).toBe('I keep forgetting to water the plants');
  });

  it('adds Context: edits the Dump while preserving the verbatim original in a ## Original section', async () => {
    const session = await beginCapture('I keep forgetting to water the plants', beginDeps());
    const updated = await addContext(session, 'they are the basil on the windowsill', contextDeps());

    const chunk = await dumpChunk(updated);
    expect(chunk.data).toContain('## Original');
    expect(chunk.data).toContain('I keep forgetting to water the plants'); // preserved verbatim
    expect(chunk.data).toContain('## Context');
    expect(chunk.data).toContain('they are the basil on the windowsill');
    expect(updated.dump.context).toBe('they are the basil on the windowsill');
  });

  it('holds the preview while Context is added — no re-organize per edit', async () => {
    const session = await beginCapture('a thought', beginDeps());
    const previewBefore = session.preview;
    await addContext(session, 'extra detail one', contextDeps());
    await addContext(session, 'extra detail two', contextDeps());

    expect(organizeCalls).toHaveLength(1); // only the initial Organize — no live re-organize
    expect(session.preview).toBe(previewBefore); // the same preview object is held
  });

  it('finalizes at autosave: re-organizes over the full Dump (original + Context), writes the Note, freezes the Dump', async () => {
    const session = await settleMatch(
      await beginCapture('I keep forgetting to water the plants', beginDeps()),
      { db, settings, matcher: newOnlyMatcher },
    );
    const withContext = await addContext(session, 'they are the basil on the windowsill', contextDeps());

    const result = await finalizeCapture(withContext, finalizeDeps());

    expect(result.ok).toBe(true);
    if (!result.ok) return; // narrow the discriminated union for the type checker
    // The final Organize ran over the full Dump — original plus the added Context.
    expect(organizeCalls).toHaveLength(2);
    expect(organizeCalls[1].content).toContain('I keep forgetting to water the plants');
    expect(organizeCalls[1].content).toContain('## Context');
    expect(organizeCalls[1].content).toContain('they are the basil on the windowsill');
    // The Note reflects the final-organized title (with context), in the managed folder.
    expect(result.note.title).toBe('Water the plants (with context)');
    expect(result.written.path).toBe('Brain Dump/2026-08-21-water-the-plants-with-context.md');
    expect(result.session.saved).toBe(true); // the Dump is frozen
  });

  it('finalizes a Dump with no Context: the preview is the Note — no second Organize', async () => {
    const session = await settleMatch(
      await beginCapture('I keep forgetting to water the plants', beginDeps()),
      { db, settings, matcher: newOnlyMatcher },
    );
    const result = await finalizeCapture(session, finalizeDeps());

    expect(result.ok).toBe(true);
    if (!result.ok) return; // narrow the discriminated union for the type checker
    // No Context → the preview already is the Organize of the unchanged Dump, so it is saved as-is.
    expect(organizeCalls).toHaveLength(1);
    expect(result.note).toEqual(session.preview);
    expect(result.written.path).toBe('Brain Dump/2026-08-21-water-the-plants.md');
    expect(result.session.saved).toBe(true);
  });

  it('freezes the Dump once the Note is saved — adding Context throws', async () => {
    const session = await settleMatch(await beginCapture('a thought', beginDeps()), { db, settings, matcher: newOnlyMatcher });
    const result = await finalizeCapture(session, finalizeDeps());
    expect(result.ok).toBe(true);

    await expect(addContext(result.session, 'late context', contextDeps())).rejects.toThrow();
  });

  it('refuses to finalize an already-saved session', async () => {
    const session = await settleMatch(await beginCapture('a thought', beginDeps()), { db, settings, matcher: newOnlyMatcher });
    const first = await finalizeCapture(session, finalizeDeps());
    expect(first.ok).toBe(true);

    await expect(finalizeCapture(first.session, finalizeDeps())).rejects.toThrow();
  });

  it('keeps the Dump (with Context) and defers the Note when the final save fails', async () => {
    const session = await settleMatch(
      await beginCapture('I keep forgetting to water the plants', beginDeps()),
      { db, settings, matcher: newOnlyMatcher },
    );
    const withContext = await addContext(session, 'they are the basil on the windowsill', contextDeps());

    const result = await finalizeCapture(withContext, finalizeDeps(dbThatFailsNoteWrites(db)));

    expect(result.ok).toBe(false);
    if (result.ok) return; // narrow the discriminated union for the type checker
    expect(result.error).toBeInstanceOf(Error);
    expect(result.session.saved).toBe(false); // unsaved — the Note can be generated from it later

    // The Dump still holds the added Context (it persists).
    const chunk = await dumpChunk(withContext);
    expect(chunk.data).toContain('## Context');
    expect(chunk.data).toContain('they are the basil on the windowsill');

    // No Note metadata doc was written to the managed folder.
    await expect(
      db.get(docIdForPath('Brain Dump/2026-08-21-water-the-plants-with-context.md', settings)),
    ).rejects.toThrow();
  });

  it('logs a failed save — the one failure the user is watching must be in the durable log (ticket 09)', async () => {
    const entries: Array<{ level?: string; op?: string; message: string; detail?: { dumpId?: string } }> = [];
    const session = await settleMatch(
      await beginCapture('I keep forgetting to water the plants', beginDeps()),
      { db, settings, matcher: newOnlyMatcher },
    );

    await finalizeCapture(session, {
      ...finalizeDeps(dbThatFailsNoteWrites(db)),
      log: (event) => entries.push(event),
    });

    const failure = entries.find((e) => e.level === 'error' && e.message.includes('save failed'));
    expect(failure).toBeDefined();
    expect(failure?.detail?.dumpId).toBe(fixedId);
  });
});

// Seam A — match sequencing (capture-latency ticket 03): the preview renders as soon as
// Organize returns, and the new-vs-append decision settles behind it. The Matcher fake
// resolves on demand, so the suite can express "the preview exists and the match does
// not yet" — the whole point of the ticket.
describe('match sequencing (Seam A — capture-latency ticket 03)', () => {
  const sampleOutput: OrganizeOutput = {
    title: 'Water the plants',
    tags: ['home', 'plants'],
    category: 'personal',
    summary: 'A reminder to water the plants.',
    keyPoints: ['Water the plants regularly'],
    related: ['[[plants]]'],
    body: 'I keep forgetting to water the plants.',
  };
  const organizer: Organizer = { organize: async () => sampleOutput };

  const beginDeps = (matcher: Matcher) => ({
    db,
    settings,
    organizer,
    matcher,
    now: () => fixedNow,
    newId: () => fixedId,
    hash: sha1Hex,
  });

  /** A Matcher whose resolution the test controls: calls are counted, and the promise is
   *  resolved only when the test says so. */
  function deferredMatcher(): {
    matcher: Matcher;
    calls: () => number;
    resolve: () => void;
  } {
    let count = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    return {
      matcher: {
        match: async (...args) => {
          count += 1;
          await gate;
          return newOnlyMatcher.match(...args);
        },
      },
      calls: () => count,
      resolve: release,
    };
  }

  /** Seed one existing Note so the matcher is reached at all — with an empty vault
   *  `matchNote` decides new without calling it. */
  const seedOneNote = async () => {
    await writeNote(
      {
        title: 'Water the plants',
        tags: ['home', 'plants'],
        createdAt: fixedNow,
        modality: 'text',
        source: '[[_dumps/20260821-203045-aaaaaa]]',
        category: 'personal',
        summary: 'A reminder to water the plants.',
        body: 'I keep forgetting to water the plants.',
        keyPoints: ['Water the plants regularly'],
        related: ['[[plants]]'],
      },
      db,
      settings,
      sha1Hex,
    );
  };

  it('the preview is available after exactly one Organizer call and zero Matcher resolutions', async () => {
    const { matcher, calls } = deferredMatcher();
    const session = await beginCapture('I keep forgetting to water the plants', beginDeps(matcher));

    // The whole preview is readable, and the decision it renders in its buttons is
    // explicitly "not decided yet" — not `new` wearing a placeholder.
    expect(session.preview.title).toBe('Water the plants');
    expect(session.match.kind).toBe('undecided');
    expect(calls()).toBe(0);
  });

  it('settleMatch resolves the decision behind the preview', async () => {
    await seedOneNote();
    const { matcher, calls, resolve } = deferredMatcher();
    const session = await beginCapture('a thought', beginDeps(matcher));
    expect(session.match.kind).toBe('undecided');

    const settling = settleMatch(session, { db, settings, matcher });
    resolve();
    const settled = await settling;

    expect(calls()).toBe(1);
    expect(settled.match.kind).toBe('new');
    expect(settled.preview).toBe(session.preview); // the same preview object is held
  });

  it('finalizeCapture refuses to save while the match is unresolved — it must not guess new', async () => {
    const { matcher } = deferredMatcher();
    const session = await beginCapture('a thought', beginDeps(matcher));

    // Saving an undecided session would found a second Note — the exact failure the
    // Matcher exists to prevent — so the save refuses rather than guessing.
    await expect(
      finalizeCapture(session, {
        db,
        settings,
        organizer,
        hash: sha1Hex,
        now: () => fixedNow,
      }),
    ).rejects.toThrow('decision has not been made');
    // Nothing was written to the managed folder.
    await expect(
      db.get(docIdForPath('Brain Dump/2026-08-21-water-the-plants.md', settings)),
    ).rejects.toThrow();
  });

  it('a Matcher that rejects still settles to new, and the session files as a new Note', async () => {
    const rejecting: Matcher = { match: async () => { throw new Error('matcher exploded'); } };
    const session = await beginCapture('a thought', beginDeps(rejecting));

    const settled = await settleMatch(session, { db, settings, matcher: rejecting });
    expect(settled.match.kind).toBe('new');

    const result = await finalizeCapture(settled, {
      db,
      settings,
      organizer,
      hash: sha1Hex,
      now: () => fixedNow,
    });
    expect(result.ok).toBe(true);
  });
});
// Autosave timing through the operation layer (Seam A): the 5s inactivity timer
// drives the real finalize path (beginCapture → addContext → finalizeCapture),
// asserting on the stored Note doc — not on a mock save spy. The Organizer is a
// deterministic fake; CouchDB is the in-memory PouchDB stand-in (see spec §Testing).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import PouchDB from 'pouchdb-core';
import memory from 'pouchdb-adapter-memory';
import {
  beginCapture,
  settleMatch,
  addContext,
  finalizeCapture,
  writeDump,
  writeNote,
  wikilink,
  type CaptureSession,
} from '../src/lib/operations';
import { createAutosaver, AUTOSAVE_DELAY_MS } from '../src/lib/autosave';
import { docIdForPath } from '../src/lib/livesync';
import {
  DEFAULT_SETTINGS,
  type Settings,
  type DocStore,
  type Organizer,
  type OrganizeOutput,
  type Matcher,
  type MatchSuggestion,
  type Note,
  type Dump,
  type Modality,
} from '../src/lib/types';

PouchDB.plugin(memory);

// Ticket 04: beginCapture matches the preview against existing Notes. The
// autosave flow writes a new Note, so it passes a matcher that always suggests new.
const newOnlyMatcher: Matcher = { match: async () => ({ kind: 'new' }) };

function sha1Hex(c: string): Promise<string> {
  return Promise.resolve(createHash('sha1').update(c).digest('hex'));
}

const fixedNow = Date.UTC(2026, 7, 21, 20, 30, 45); // 2026-08-21 20:30:45 UTC
const fixedId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const settings: Settings = { ...DEFAULT_SETTINGS, dumpsFolder: '_dumps', managedFolder: 'Brain Dump' };

const sampleOutput: OrganizeOutput = {
  title: 'Water the plants',
  tags: ['home', 'plants'],
  category: 'personal',
  summary: 'A reminder to water the plants.',
  keyPoints: ['Water the plants regularly'],
  related: ['[[plants]]'],
  body: 'I keep forgetting to water the plants.',
};

let db: DocStore;
let seq = 0;
let organizer: Organizer;

beforeEach(() => {
  db = new PouchDB('a' + seq++, { adapter: 'memory' }) as unknown as DocStore;
  // The final Organize (over the full Dump) reflects the added Context, so the
  // saved Note's title differs from the preview — proving the save path ran.
  organizer = {
    organize: async (content) =>
      content.includes('## Context') ? { ...sampleOutput, title: 'Water the plants (with context)' } : sampleOutput,
  };
});

const beginDeps = () => ({ db, settings, organizer, matcher: newOnlyMatcher, now: () => fixedNow, newId: () => fixedId, hash: sha1Hex });
const finalizeDeps = () => ({ db, settings, organizer, hash: sha1Hex, now: () => fixedNow });

/** Whether the final Note has been written to the managed folder (observable outcome). */
async function noteWritten(slug: string): Promise<boolean> {
  try {
    await db.get(docIdForPath(`Brain Dump/2026-08-21-${slug}.md`, settings));
    return true;
  } catch {
    return false;
  }
}

/** Read the current raw content of a Note or Dump file (its single chunk's `data`). */
async function noteContent(path: string): Promise<string> {
  const meta = await db.get<{ children: string[] }>(docIdForPath(path, settings));
  const chunk = await db.get<{ data: string }>(meta.children[0]);
  return chunk.data;
}

async function sessionWithContext(): Promise<CaptureSession> {
  const s = await beginCapture('I keep forgetting to water the plants', beginDeps());
  // Capture-latency ticket 03: beginCapture leaves the match undecided; the save refuses
  // an undecided session, so the autosave suites settle it the way the app does before
  // arming the timer.
  const settled = await settleMatch(s, { db, settings, matcher: newOnlyMatcher });
  return addContext(settled, 'they are the basil on the windowsill', { db, settings, hash: sha1Hex });
}

/** The autosave save callback: finalize the session (returning void, not the
 *  FinalizeResult, to match the Autosaver.save signature). */
function saveOf(session: CaptureSession): () => Promise<void> {
  return async () => {
    await finalizeCapture(session, finalizeDeps());
  };
}

/** Poll for the Note until the timer's fire-and-forget save (`void run()`) lands.
 *  The save chain is microtask-driven (the flush test completes it under fake
 *  timers), so polling with microtask yields drains it regardless of length. */
async function waitForNote(slug: string): Promise<boolean> {
  for (let i = 0; i < 1000; i++) {
    await Promise.resolve();
    if (await noteWritten(slug)) return true;
  }
  return false;
}

describe('autosave timing (Seam A — ticket 03)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('writes the Note after the 5s inactivity delay, and not before', async () => {
    const session = await sessionWithContext();
    createAutosaver({ save: saveOf(session) }).schedule();

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 1);
    expect(await noteWritten('water-the-plants-with-context')).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(await waitForNote('water-the-plants-with-context')).toBe(true);
  });

  it('debounces: activity within the 5s resets the timer — only the last idle window saves', async () => {
    const session = await sessionWithContext();
    const a = createAutosaver({ save: saveOf(session) });
    a.schedule();
    await vi.advanceTimersByTimeAsync(3000);
    a.schedule(); // activity resets the idle timer

    await vi.advanceTimersByTimeAsync(3000); // only 3s since the reschedule
    expect(await noteWritten('water-the-plants-with-context')).toBe(false);

    await vi.advanceTimersByTimeAsync(2000); // 5s since the reschedule
    expect(await waitForNote('water-the-plants-with-context')).toBe(true);
  });

  it('flush saves immediately on close (beforeunload), before the 5s timer fires', async () => {
    const session = await sessionWithContext();
    const a = createAutosaver({ save: saveOf(session) });
    a.schedule();
    await vi.advanceTimersByTimeAsync(1000); // before the 5s fires — user closes the app

    await a.flush();
    expect(await noteWritten('water-the-plants-with-context')).toBe(true);

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS); // the cancelled pending timer must not fire again
    expect(await noteWritten('water-the-plants-with-context')).toBe(true);
  });

  it('cancel stops the pending save without writing the Note', async () => {
    const session = await sessionWithContext();
    const a = createAutosaver({ save: saveOf(session) });
    a.schedule();
    a.cancel();

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(await noteWritten('water-the-plants-with-context')).toBe(false);
  });

  // --- Hold (ticket 05) ---------------------------------------------------
  // Hold is this cancel plus a UI state, and nothing more: the autosave module gains no new
  // interface for it. What Hold promises is that the clock, once stopped, never starts again
  // on its own — so the only thing that may write the Note after a cancel is the user
  // explicitly filing it.

  it('after cancel, time alone never files the Note — only an explicit flush does', async () => {
    const session = await sessionWithContext();
    const a = createAutosaver({ save: saveOf(session) });
    a.schedule();
    a.cancel(); // the user pressed Hold

    // Far past the window, several windows over: a stopped clock stays stopped.
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 10);
    expect(await noteWritten('water-the-plants-with-context')).toBe(false);

    await a.flush(); // the user explicitly files
    expect(await noteWritten('water-the-plants-with-context')).toBe(true);
  });

  it('exposes exactly schedule, flush and cancel — Hold adds no interface (#12)', () => {
    const a = createAutosaver({ save: async () => {} });
    expect(Object.keys(a).sort()).toEqual(['cancel', 'flush', 'schedule']);
  });

  // --- Match sequencing (capture-latency ticket 03) ------------------------
  // The timer is armed only once the match has settled. While the decision is
  // unresolved the save refuses to guess — a save that guessed `new` would found
  // a duplicate Note, the exact failure the Matcher exists to prevent.

  it('no save occurs while the match is unresolved, however long that is (capture-latency ticket 03)', async () => {
    const s = await beginCapture('I keep forgetting to water the plants', beginDeps());
    // The save swallows the refusal the way saveAndFinalize catches its own errors —
    // the assertion is on what was written, not on what the timer reported.
    createAutosaver({
      save: async () => {
        try {
          await finalizeCapture(s, finalizeDeps());
        } catch {
          /* the save refuses an undecided match */
        }
      },
    }).schedule();

    // Ten autosave windows over an undecided session: nothing is written, ever.
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 10);
    expect(await noteWritten('water-the-plants')).toBe(false);

    // Settling the decision is what makes an honest save possible.
    const settled = await settleMatch(s, { db, settings, matcher: newOnlyMatcher });
    createAutosaver({ save: saveOf(settled) }).schedule();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(await waitForNote('water-the-plants')).toBe(true);
  });

  // The other half of the sequencing contract: a decision that arrives *after* the idle
  // window has elapsed must still be honored. The late save appends to the matched Note —
  // it does not found the second Note a save that guessed `new` would create.
  it('a match resolving to append after the delay has elapsed still appends (capture-latency ticket 03)', async () => {
    // The Note the delayed decision will land on: a Dump file its `source` resolves to,
    // or the append path would fall back to founding.
    const dump: Dump = {
      id: 'aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      content: 'First verbatim capture.',
      context: '',
      createdAt: fixedNow,
      modality: 'text' as Modality,
    };
    const dumpWritten = await writeDump(dump, { db, settings, hash: sha1Hex });
    const note: Note = {
      title: 'Water the plants',
      tags: ['home', 'plants'],
      createdAt: fixedNow,
      modality: 'text' as Modality,
      source: wikilink(dumpWritten.path),
      category: 'personal',
      summary: 'A reminder to water the plants.',
      body: 'I keep forgetting to water the plants.',
      keyPoints: ['Water the plants regularly'],
      related: ['[[plants]]'],
    };
    const existingPath = (await writeNote(note, db, settings, sha1Hex)).path;

    // The matcher says append — to the Note actually seeded, not whichever candidate
    // happens to come first.
    const appendToSeededMatcher: Matcher = {
      match: (_topic, candidates) => {
        const target = candidates.find((c) => c.path === existingPath);
        return Promise.resolve<MatchSuggestion>(
          target ? { kind: 'append', path: target.path } : { kind: 'new' },
        );
      },
    };
    const s = await beginCapture('the basil needs pruning', {
      ...beginDeps(),
      matcher: appendToSeededMatcher,
    });

    let finalizedPath = '';
    let saveError = '';
    const save = async (session: CaptureSession) => {
      try {
        const result = await finalizeCapture(session, finalizeDeps());
        if (result.ok) finalizedPath = result.written.path;
        else saveError = result.error.message;
      } catch (e) {
        saveError = (e as Error).message;
      }
    };
    const a = createAutosaver({ save: () => save(s) });
    a.schedule();

    // Two idle windows over the undecided session: nothing is filed.
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(finalizedPath).toBe('');
    expect(saveError).toBe('Cannot save: the new-vs-append decision has not been made yet.');

    // The decision arrives late — after the windows have elapsed — and says append.
    // Re-arming, as the app does when the match settles, the late save honors it.
    const settled = await settleMatch(s, { db, settings, matcher: appendToSeededMatcher });
    saveError = '';
    createAutosaver({ save: () => save(settled) }).schedule();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    // The timer's fire-and-forget save chain interleaves PouchDB macrotasks with
    // microtasks — alternate flushing both until it lands, the way waitForNote does
    // for the founding path.
    for (let i = 0; i < 100 && !finalizedPath && !saveError; i++) {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1);
    }
    expect(saveError).toBe('');
    // The capture joined the target's Dump as a dated section, and the Note was
    // rewritten in place at its frozen path — no second Note was founded.
    expect(finalizedPath).toBe(existingPath);
    const dumpContent = await noteContent(dumpWritten.path);
    expect(dumpContent).toContain('## Appended');
    expect(dumpContent).toContain('the basil needs pruning');
    const all = await db.allDocs({ include_docs: true });
    const managedNotes = all.rows.filter(
      (r) =>
        (r.doc as { type?: string; path?: string })?.type === 'plain' &&
        (r.doc as { path?: string }).path?.startsWith(`${settings.managedFolder}/`),
    );
    expect(managedNotes).toHaveLength(1);
  });
});

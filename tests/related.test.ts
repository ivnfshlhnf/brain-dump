// Seam A — Related links, driven through the finalize path and asserted on the Note that
// actually lands in the vault. The embedder and the judge are deterministic fakes; nothing
// here reaches into the ranking module.
//
// Two assertions matter more than the rest:
//   - every emitted link points at a document that exists (a dead link in the user's vault is
//     the failure this feature was built to avoid), and
//   - finalizing writes no document other than the new Note ("outbound links only" must be a
//     tested property, not an intention).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import PouchDB from 'pouchdb-core';
import memory from 'pouchdb-adapter-memory';
import { beginCapture, settleMatch, settleRelated, finalizeCapture, addContext, RELATED_DEADLINE_MS } from '../src/lib/operations';
import { RELATED_MAX } from '../src/lib/related';
import { writeFile, readVaultFiles } from '../src/lib/livesync';
import {
  DEFAULT_SETTINGS,
  type Settings,
  type DocStore,
  type Embedder,
  type Organizer,
  type Matcher,
  type Relater,
} from '../src/lib/types';

PouchDB.plugin(memory);

const sha1Hex = (c: string) => Promise.resolve(createHash('sha1').update(c).digest('hex'));
const fixedNow = Date.UTC(2026, 7, 21, 20, 30, 45);
const settings: Settings = { ...DEFAULT_SETTINGS, managedFolder: 'Brain Dump', dumpsFolder: '_dumps' };

// One dimension per topic word: similarity is exact topic overlap, so a test can decide
// precisely which documents are close to the new Note.
const TOPICS = ['plants', 'taxes', 'guitar', 'basil'];
const embedder: Embedder = {
  embed: async (texts) =>
    texts.map((t) => TOPICS.map((topic) => (t.toLowerCase().includes(topic) ? 1 : 0))),
};

const organizer: Organizer = {
  organize: async (content) => ({
    title: 'Watering the plants',
    tags: ['plants'],
    category: 'personal',
    summary: 'A note about plants.',
    keyPoints: ['water them'],
    related: [], // Organize cannot know this — the whole point of the feature
    body: content,
  }),
};

const newMatcher: Matcher = { match: async () => ({ kind: 'new' }) };

/** A judge that accepts every candidate it is shown, so tests exercise the ranking and the
 *  validation rather than the model's taste. */
let judged: Array<{ subject: unknown; candidates: Array<{ path: string }> }> = [];
const acceptAll: Relater = {
  related: async (subject, candidates) => {
    judged.push({ subject, candidates });
    return candidates.map((_, i) => i);
  },
};

let db: DocStore;
let seq = 0;

async function seedDoc(path: string, body: string, title = path) {
  await writeFile(db, path, `---\ntitle: ${title}\n---\n${body}`, {
    ctime: fixedNow,
    mtime: fixedNow,
    hash: sha1Hex,
    settings,
  });
}

const captureDeps = (over: { embedder?: Embedder; relater?: Relater } = {}) => ({
  db,
  settings,
  hash: sha1Hex,
  now: () => fixedNow,
  newId: () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  organizer,
  matcher: newMatcher,
  embedder,
  relater: acceptAll,
  ...over,
});

const finalizeDeps = (relater: Relater = acceptAll) => ({
  db,
  settings,
  hash: sha1Hex,
  now: () => fixedNow,
  organizer,
  embedder,
  relater,
});

/** The `## Related` lines of the Note that was written. */
async function relatedLinksOf(path: string): Promise<string[]> {
  const files = await readVaultFiles(db, (p) => p === path);
  const body = files[0]?.content ?? '';
  const section = body.split('## Related')[1] ?? '';
  return section
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2));
}

/** Every vault path currently present, for asserting what a save did and did not write. */
async function allPaths(): Promise<string[]> {
  const files = await readVaultFiles(db, () => true);
  return files.map((f) => f.path).sort();
}

/** Path -> content for the whole vault, so a test can prove a document was left untouched
 *  rather than merely still present. */
async function snapshot(): Promise<Map<string, string>> {
  const files = await readVaultFiles(db, () => true);
  return new Map(files.map((f) => [f.path, f.content]));
}

beforeEach(() => {
  db = new PouchDB('rel' + seq++, { adapter: 'memory' }) as unknown as DocStore;
  judged = [];
});

describe('Related links on a saved Note', () => {
  it('links to a document about the same topic', async () => {
    await seedDoc('Brain Dump/2026-01-01-plants.md', 'Notes on plants and watering.');

    const session = await settleMatch(await beginCapture('The plants need water', captureDeps()), { db, settings, matcher: newMatcher });
    const result = await finalizeCapture(session, finalizeDeps());

    expect(result.ok).toBe(true);
    const links = await relatedLinksOf(result.ok ? result.written.path : '');
    expect(links).toContain('[[Brain Dump/2026-01-01-plants]]');
  });

  it('links only to documents that exist in the vault', async () => {
    await seedDoc('Brain Dump/2026-01-01-plants.md', 'Notes on plants.');
    await seedDoc('personal/garden.md', 'My basil and plants journal.');

    const session = await settleMatch(await beginCapture('The plants need water', captureDeps()), { db, settings, matcher: newMatcher });
    const result = await finalizeCapture(session, finalizeDeps());
    const links = await relatedLinksOf(result.ok ? result.written.path : '');

    // The guarantee the whole design exists to provide: the model chooses from a list the app
    // built from the vault, so it cannot produce a link to something that is not there.
    const paths = await allPaths();
    for (const link of links) {
      const target = link.replace(/^\[\[|\]\]$/g, '') + '.md';
      expect(paths).toContain(target);
    }
    expect(links.length).toBeGreaterThan(0);
  });

  it('draws on personal notes, not just the managed folder', async () => {
    await seedDoc('personal/garden.md', 'My basil and plants journal.');

    const session = await settleMatch(await beginCapture('The plants need water', captureDeps()), { db, settings, matcher: newMatcher });
    const result = await finalizeCapture(session, finalizeDeps());
    const links = await relatedLinksOf(result.ok ? result.written.path : '');

    // ADR-0002: Retrieve reads the whole vault, and so does this. Safe because links are
    // outbound only — nothing is ever written to a personal note.
    expect(links).toContain('[[personal/garden]]');
  });

  it('changes no other document — no reverse links', async () => {
    await seedDoc('Brain Dump/2026-01-01-plants.md', 'Notes on plants.');
    await seedDoc('personal/garden.md', 'My basil and plants journal.');

    const session = await settleMatch(await beginCapture('The plants need water', captureDeps()), { db, settings, matcher: newMatcher });
    // Snapshot content, not just paths: a reverse link would edit an existing Note in place
    // and leave the path set identical, so comparing paths alone would not catch it.
    const before = await snapshot();
    const result = await finalizeCapture(session, finalizeDeps());
    const after = await snapshot();

    const added = [...after.keys()].filter((p) => !before.has(p));
    expect(added).toEqual([result.ok ? result.written.path : '']);
    for (const [path, content] of before) {
      expect(after.get(path)).toBe(content);
    }
  });

  it('leaves Related empty when nothing clears the similarity floor', async () => {
    await seedDoc('personal/taxes.md', 'The taxes are due in April.');

    const session = await settleMatch(await beginCapture('The plants need water', captureDeps()), { db, settings, matcher: newMatcher });
    const result = await finalizeCapture(session, finalizeDeps());
    const links = await relatedLinksOf(result.ok ? result.written.path : '');

    // No Related links is a better answer than weak ones.
    expect(links).toEqual([]);
    expect(judged).toHaveLength(0);
  });

  it('never offers more than RELATED_MAX candidates to the judge', async () => {
    for (let i = 0; i < RELATED_MAX + 4; i++) {
      await seedDoc(`Brain Dump/2026-01-0${i}-plants.md`, `Plants note number ${i}.`);
    }

    const session = await settleMatch(await beginCapture('The plants need water', captureDeps()), { db, settings, matcher: newMatcher });
    const result = await finalizeCapture(session, finalizeDeps());
    const links = await relatedLinksOf(result.ok ? result.written.path : '');

    expect(judged[0].candidates.length).toBe(RELATED_MAX);
    expect(links.length).toBeLessThanOrEqual(RELATED_MAX);
  });

  it('does not let a Note list itself', async () => {
    await seedDoc('Brain Dump/2026-01-01-plants.md', 'Notes on plants.');

    const session = await settleMatch(await beginCapture('The plants need water', captureDeps()), { db, settings, matcher: newMatcher });
    const result = await finalizeCapture(session, finalizeDeps());
    const links = await relatedLinksOf(result.ok ? result.written.path : '');
    const self = (result.ok ? result.written.path : '').replace(/\.md$/, '');

    expect(links).not.toContain(`[[${self}]]`);
  });

  it('excludes raw Dumps from Related', async () => {
    await seedDoc('Brain Dump/2026-01-01-plants.md', 'Notes on plants.');

    const session = await settleMatch(await beginCapture('The plants need water', captureDeps()), { db, settings, matcher: newMatcher });
    const result = await finalizeCapture(session, finalizeDeps());
    const links = await relatedLinksOf(result.ok ? result.written.path : '');

    // A Dump's content is already represented by its Note; linking to the archive file the
    // user does not browse would be noise.
    expect(links.some((l) => l.includes('_dumps/'))).toBe(false);
  });

  it('drops an index the judge invented rather than turning it into a link', async () => {
    await seedDoc('Brain Dump/2026-01-01-plants.md', 'Notes on plants.');
    const liar: Relater = { related: async () => [0, 99, -1, 0] };

    const session = await settleMatch(await beginCapture('The plants need water', captureDeps({ relater: liar })), { db, settings, matcher: newMatcher });
    const result = await finalizeCapture(session, finalizeDeps(liar));
    const links = await relatedLinksOf(result.ok ? result.written.path : '');

    // Out of range is dropped; a repeated index does not produce a repeated link.
    expect(links).toEqual(['[[Brain Dump/2026-01-01-plants]]']);
  });

  it('still saves the Note when the judge fails', async () => {
    await seedDoc('Brain Dump/2026-01-01-plants.md', 'Notes on plants.');
    const broken: Relater = {
      related: async () => {
        throw new Error('provider down');
      },
    };

    const session = await settleMatch(await beginCapture('The plants need water', captureDeps({ relater: broken })), { db, settings, matcher: newMatcher });
    const result = await finalizeCapture(session, finalizeDeps(broken));

    // Losing the links is far better than losing the Note.
    expect(result.ok).toBe(true);
    const links = await relatedLinksOf(result.ok ? result.written.path : '');
    expect(links).toEqual([]);
  });

  it('writes no Related links when the caller supplies no embedder and judge', async () => {
    await seedDoc('Brain Dump/2026-01-01-plants.md', 'Notes on plants.');

    const session = await settleMatch(await beginCapture('The plants need water', captureDeps({ embedder: undefined, relater: undefined })), { db, settings, matcher: newMatcher });
    const result = await finalizeCapture(session, {
      db,
      settings,
      hash: sha1Hex,
      now: () => fixedNow,
      organizer,
    });

    expect(result.ok).toBe(true);
    expect(await relatedLinksOf(result.ok ? result.written.path : '')).toEqual([]);
  });
});

describe('Related for the preview (capture-latency ticket 04)', () => {
  /** A judge whose answer the test controls — its promise stays pending until `release`. */
  function deferredRelater() {
    const calls: Array<Array<{ path: string }>> = [];
    let release!: (picked: number[]) => void;
    const gate = new Promise<number[]>((resolve) => (release = resolve));
    const relater: Relater = {
      related: async (_subject, candidates) => {
        calls.push(candidates);
        return gate;
      },
    };
    return { relater, calls, release };
  }

  it('computes the links for the preview, and finalizing reuses them with zero extra Relater calls', async () => {
    await seedDoc('Brain Dump/2026-01-01-plants.md', 'Notes on plants.');

    const session = await settleMatch(await beginCapture('The plants need water', captureDeps()), { db, settings, matcher: newMatcher });
    // The pass starts with the capture, before anyone waits on it.
    expect(session.related).toBe('resolving');

    const settled = await settleRelated(session);
    expect(settled.related).toBe('done');
    expect(settled.preview.related).toContain('[[Brain Dump/2026-01-01-plants]]');
    const calls = judged.length;
    expect(calls).toBe(1);

    const result = await finalizeCapture(settled, finalizeDeps());
    // The reuse property — the whole point of the ticket: the save pays for no second
    // ranking whose only possible effect was to disagree with the one already shown.
    expect(judged.length).toBe(calls);
    expect(await relatedLinksOf(result.ok ? result.written.path : '')).toContain('[[Brain Dump/2026-01-01-plants]]');
  });

  it('with Context added, finalizing recomputes: exactly one more Relater call, and the Note carries the recomputed links', async () => {
    await seedDoc('Brain Dump/2026-01-01-plants.md', 'Notes on plants.');

    const settled = await settleRelated(await settleMatch(await beginCapture('The plants need water', captureDeps()), { db, settings, matcher: newMatcher }));
    expect(judged.length).toBe(1);
    const withContext = await addContext(settled, 'they are the basil on the windowsill', { db, settings, hash: sha1Hex });

    const result = await finalizeCapture(withContext, finalizeDeps());
    expect(result.ok).toBe(true);
    expect(judged.length).toBe(2);
    expect(await relatedLinksOf(result.ok ? result.written.path : '')).toContain('[[Brain Dump/2026-01-01-plants]]');
  });

  it('a Relater that never resolves still files the Note, with an empty Related section, within the deadline', async () => {
    await seedDoc('Brain Dump/2026-01-01-plants.md', 'Notes on plants.');
    const { relater } = deferredRelater();
    const session = await settleMatch(await beginCapture('The plants need water', captureDeps({ relater })), { db, settings, matcher: newMatcher });

    // The deadline is measured from when the pass started, not from when the save waits —
    // backdate the start so the deadline is already exhausted when the save gives it the
    // rest of its time.
    session.relatedStartedAt = Date.now() - RELATED_DEADLINE_MS - 1;

    const result = await finalizeCapture(session, finalizeDeps(relater));

    expect(result.ok).toBe(true);
    expect(result.ok && result.session.related).toBe('missed');
    const links = await relatedLinksOf(result.ok ? result.written.path : '');
    expect(links).toEqual([]);
  });

  it('a Relater that rejects behaves like a deadline miss — the Note is still filed', async () => {
    await seedDoc('Brain Dump/2026-01-01-plants.md', 'Notes on plants.');
    const broken: Relater = {
      related: async () => {
        throw new Error('provider down');
      },
    };

    const session = await settleMatch(await beginCapture('The plants need water', captureDeps({ relater: broken })), { db, settings, matcher: newMatcher });
    const settled = await settleRelated(session);
    expect(settled.related).toBe('missed');
    expect(settled.relatedRun).toBeUndefined(); // a failed pass is terminal — the follow-up must not wait on it

    const result = await finalizeCapture(settled, finalizeDeps(broken));
    expect(result.ok).toBe(true);
    expect(await relatedLinksOf(result.ok ? result.written.path : '')).toEqual([]);
  });

  it('a pass that lands after the deadline but before the save is still used', async () => {
    await seedDoc('Brain Dump/2026-01-01-plants.md', 'Notes on plants.');
    const deferred = deferredRelater();

    const session = await settleMatch(await beginCapture('The plants need water', captureDeps({ relater: deferred.relater })), { db, settings, matcher: newMatcher });
    const missed = await settleRelated(session, { timeoutMs: 0 });
    expect(missed.related).toBe('missed');
    expect(missed.relatedRun).toBeDefined(); // the deadline miss keeps the run alive

    deferred.release([0]); // the judge finally answers
    const landed = await settleRelated(missed, { timeoutMs: 2147483647 }); // the sheet's follow-up: no deadline
    expect(landed.related).toBe('done');
    expect(landed.preview.related).toContain('[[Brain Dump/2026-01-01-plants]]');

    const result = await finalizeCapture(landed, finalizeDeps(deferred.relater));
    expect(await relatedLinksOf(result.ok ? result.written.path : '')).toContain('[[Brain Dump/2026-01-01-plants]]');
  });

  it('an honest empty result is done, not missed — nothing cleared the floor', async () => {
    await seedDoc('personal/taxes.md', 'The taxes are due in April.');

    const session = await beginCapture('The plants need water', captureDeps());
    const settled = await settleRelated(session);

    expect(settled.related).toBe('done');
    expect(settled.preview.related).toEqual([]);
    expect(judged).toHaveLength(0);
  });
});

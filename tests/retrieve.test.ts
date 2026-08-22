// Seam A — Retrieve, tested as a black box. The vault is the in-memory PouchDB
// stand-in seeded with both the app's Notes and hand-written "personal" notes;
// the embedder and the answering LLM are deterministic fakes (see spec §Testing).
// No test hits the network or a real model.
import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import PouchDB from 'pouchdb-core';
import memory from 'pouchdb-adapter-memory';
import { retrieve, RETRIEVE_TOP_K, EMPTY_VAULT_ANSWER } from '../src/lib/retrieve';
import { writeFile } from '../src/lib/livesync';
import {
  DEFAULT_SETTINGS,
  type Settings,
  type DocStore,
  type Embedder,
  type Answerer,
  type VaultDoc,
} from '../src/lib/types';

PouchDB.plugin(memory);

function sha1Hex(c: string): Promise<string> {
  return Promise.resolve(createHash('sha1').update(c).digest('hex'));
}

const fixedNow = Date.UTC(2026, 7, 21, 20, 30, 45);
const settings: Settings = { ...DEFAULT_SETTINGS, dumpsFolder: '_dumps', managedFolder: 'Brain Dump' };

// A deterministic embedder: one dimension per topic word, set when the text mentions
// it. Similarity is then exact topic overlap — no model, no network.
const TOPICS = ['plants', 'taxes', 'guitar'];
let embedCalls: string[][] = [];
const embedder: Embedder = {
  embed: async (texts) => {
    embedCalls.push(texts);
    return texts.map((t) => TOPICS.map((topic) => (t.toLowerCase().includes(topic) ? 1 : 0)));
  },
};

// A deterministic answerer: echoes the question and the sources it was given, and
// says it drew on the first one.
let answerCalls: Array<{ question: string; sources: VaultDoc[] }> = [];
const answerer: Answerer = {
  answer: async (question, sources) => {
    answerCalls.push({ question, sources });
    return { answer: `Answer to "${question}" from ${sources[0].title}`, sources: [0] };
  },
};

let db: DocStore;
let seq = 0;

const deps = () => ({ db, settings, embedder, answerer });

beforeEach(() => {
  db = new PouchDB('r' + seq++, { adapter: 'memory' }) as unknown as DocStore;
  embedCalls = [];
  answerCalls = [];
});

/** Seed a file the way the app writes one (single content-addressed chunk). */
async function seedFile(path: string, content: string) {
  await writeFile(db, path, content, { ctime: fixedNow, mtime: fixedNow, hash: sha1Hex, settings });
}

/** Seed a Note in the managed folder, with the v1 frontmatter the app writes. */
function seedNote(slug: string, title: string, body: string) {
  return seedFile(
    `Brain Dump/${slug}.md`,
    `---\ntitle: ${title}\ntags: []\ncreated: ${fixedNow}\nmodality: text\nsource: [[_dumps/x]]\ncategory: Home\nsummary: ${title}\n---\n\n${body}\n`,
  );
}

describe('retrieve (Seam A)', () => {
  it('answers from the vault and cites the Notes it drew on', async () => {
    await seedNote('plants', 'Watering the plants', 'The plants need water every Sunday.');
    await seedNote('taxes', 'Taxes', 'File the taxes before April.');

    const result = await retrieve('when do I water the plants?', deps());

    expect(result.answer).toBe('Answer to "when do I water the plants?" from Watering the plants');
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].path).toBe('Brain Dump/plants.md');
    expect(result.citations[0].title).toBe('Watering the plants');
    // An Obsidian wikilink back to the source Note, so the user can open the original.
    expect(result.citations[0].link).toBe('[[Brain Dump/plants]]');
  });

  it('draws on the whole vault, including the user personal notes', async () => {
    // A personal note the app never wrote and must never write to — but must read.
    await seedFile('Personal/journal.md', 'I bought a guitar and it needs new strings.');

    const result = await retrieve('what did I note about my guitar?', deps());

    const sourcePaths = answerCalls[0].sources.map((s) => s.path);
    expect(sourcePaths).toContain('Personal/journal.md');
    expect(result.citations[0].path).toBe('Personal/journal.md');
    // No frontmatter to take a title from — the filename stands in.
    expect(result.citations[0].title).toBe('journal');
  });

  it('writes nothing to the vault (ADR-0002: retrieval only reads)', async () => {
    await seedNote('plants', 'Watering the plants', 'The plants need water every Sunday.');
    await seedFile('Personal/journal.md', 'Guitar strings.');

    // Any write attempt during retrieval fails the test loudly.
    const readOnly: DocStore = {
      put: async () => {
        throw new Error('retrieve must not write to the vault');
      },
      get: db.get.bind(db),
      allDocs: db.allDocs.bind(db),
    };

    const result = await retrieve('plants?', { ...deps(), db: readOnly });
    expect(result.answer).toContain('Answer to');
  });

  it('reassembles a multi-chunk file (LiveSync splits large notes)', async () => {
    // Obsidian LiveSync writes big files as several chunks; the app writes one. A
    // personal note read for retrieval may be either.
    await db.put({ _id: 'h:c1', type: 'leaf', data: 'The guitar was a gift. ' });
    await db.put({ _id: 'h:c2', type: 'leaf', data: 'It needs new strings.' });
    await db.put({
      _id: 'personal/big.md',
      path: 'Personal/big.md',
      children: ['h:c1', 'h:c2'],
      ctime: fixedNow,
      mtime: fixedNow,
      size: 44,
      type: 'plain',
      eden: {},
    });

    await retrieve('guitar?', deps());

    const source = answerCalls[0].sources.find((s) => s.path === 'Personal/big.md');
    expect(source?.content).toBe('The guitar was a gift. It needs new strings.');
  });

  it('leaves raw Dumps out of the sources — Notes are what get cited', async () => {
    await seedNote('plants', 'Watering the plants', 'The plants need water every Sunday.');
    await seedFile('_dumps/20260821-203045-aaaaaa.md', '## Original\n\nplants plants plants');

    await retrieve('plants?', deps());

    const sourcePaths = answerCalls[0].sources.map((s) => s.path);
    expect(sourcePaths).toEqual(['Brain Dump/plants.md']);
  });

  it('re-embeds the vault on every Retrieve (v1 has no persistent index)', async () => {
    await seedNote('plants', 'Watering the plants', 'The plants need water every Sunday.');

    await retrieve('plants?', deps());
    const afterFirst = embedCalls.length;
    await retrieve('plants again?', deps());

    expect(afterFirst).toBeGreaterThan(0);
    expect(embedCalls.length).toBe(afterFirst * 2);
    // The vault text itself is re-embedded each time, not just the question.
    expect(embedCalls.some((c) => c.some((t) => t.includes('water every Sunday')))).toBe(true);
  });

  it('passes only the top matches to the LLM, ranked by similarity', async () => {
    // More Notes than the top-K cutoff, only some about the question's topic.
    for (let i = 0; i < RETRIEVE_TOP_K + 3; i++) {
      await seedNote(`taxes-${i}`, `Taxes ${i}`, 'Something about taxes.');
    }
    await seedNote('plants', 'Watering the plants', 'The plants need water every Sunday.');

    await retrieve('plants?', deps());

    const sources = answerCalls[0].sources;
    expect(sources.length).toBe(RETRIEVE_TOP_K);
    expect(sources[0].path).toBe('Brain Dump/plants.md'); // the best match leads
  });

  it('drops citations the model invents and falls back to the Notes it was given', async () => {
    await seedNote('plants', 'Watering the plants', 'The plants need water every Sunday.');

    const inventing: Answerer = {
      answer: async () => ({ answer: 'an answer', sources: [42, -1] }),
    };
    const result = await retrieve('plants?', { ...deps(), answerer: inventing });

    // Out-of-range indexes are dropped, so the user still gets the Notes the answer
    // was drawn from rather than a dead link.
    expect(result.citations.map((c) => c.path)).toEqual(['Brain Dump/plants.md']);
  });

  it('cites nothing when the answer drew on nothing', async () => {
    await seedNote('plants', 'Watering the plants', 'The plants need water every Sunday.');

    // "I couldn't find that" must not arrive with citations stapled to it.
    const foundNothing: Answerer = {
      answer: async () => ({ answer: 'Your notes do not cover that.', sources: [] }),
    };
    const result = await retrieve('what is my tax code?', { ...deps(), answerer: foundNothing });

    expect(result.answer).toBe('Your notes do not cover that.');
    expect(result.citations).toEqual([]);
  });

  it('fails loudly when the embedder returns no embedding for the question', async () => {
    await seedNote('plants', 'Watering the plants', 'The plants need water every Sunday.');

    // A provider that answers with an empty batch: there is nothing to rank against,
    // and answering from an arbitrary five Notes would be worse than saying so.
    const silent: Embedder = { embed: async () => [] };
    await expect(retrieve('plants?', { ...deps(), embedder: silent })).rejects.toThrow(
      /no embedding/i,
    );
  });

  it('answers without calling the model when the vault is empty', async () => {
    const result = await retrieve('anything?', deps());

    expect(result.answer).toBe(EMPTY_VAULT_ANSWER);
    expect(result.citations).toEqual([]);
    expect(answerCalls).toEqual([]);
    expect(embedCalls).toEqual([]);
  });

  it('rejects an empty question', async () => {
    await expect(retrieve('   ', deps())).rejects.toThrow();
  });
});

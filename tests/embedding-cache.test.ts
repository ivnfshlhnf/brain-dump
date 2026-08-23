// Seam A — the embedding cache, driven through Retrieve rather than poked directly.
//
// The cache is a decorator over the `Embedder` interface, which is already a dependency seam
// of the operation layer. So it is injected exactly like any other fake and its behaviour is
// observed through what Retrieve returns plus how often the inner embedder was called. No new
// seam, and nothing here reaches into the cache module's internals.
//
// The contract worth pinning is that caching changes speed and not answers: the same question
// against the same vault must produce the same citations whether the cache is cold or warm.
import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import PouchDB from 'pouchdb-core';
import memory from 'pouchdb-adapter-memory';
import { retrieve } from '../src/lib/retrieve';
import { createCachingEmbedder, encodeVector, decodeVector } from '../src/lib/embedding-cache';
import { createLog } from '../src/lib/logger';
import { writeFile } from '../src/lib/livesync';
import {
  DEFAULT_SETTINGS,
  type Settings,
  type DocStore,
  type Embedder,
  type Answerer,
} from '../src/lib/types';

PouchDB.plugin(memory);

function sha1Hex(c: string): Promise<string> {
  return Promise.resolve(createHash('sha1').update(c).digest('hex'));
}

const fixedNow = Date.UTC(2026, 7, 21, 20, 30, 45);
const settings: Settings = { ...DEFAULT_SETTINGS, managedFolder: 'Brain Dump', dumpsFolder: '_dumps' };

// The same deterministic topic embedder the retrieve suite uses, plus a call counter — the
// counter is how a cache hit becomes observable from outside.
const TOPICS = ['plants', 'taxes', 'guitar'];
let embedBatches: string[][] = [];
const countingEmbedder: Embedder = {
  embed: async (texts) => {
    embedBatches.push(texts);
    return texts.map((t) => TOPICS.map((topic) => (t.toLowerCase().includes(topic) ? 1 : 0)));
  },
};

const answerer: Answerer = {
  answer: async (question, sources) => ({
    answer: `Answer to "${question}" from ${sources[0].title}`,
    sources: [0],
  }),
};

let vault: DocStore;
let cache: DocStore;
let seq = 0;

/** Every text the inner embedder was asked for, flattened across batches. */
const embeddedTexts = () => embedBatches.flat();

function cachingEmbedder(opts: { store?: DocStore; settings?: Settings; log?: ReturnType<typeof createLog>['log'] } = {}) {
  return createCachingEmbedder({
    inner: countingEmbedder,
    store: 'store' in opts ? opts.store : cache,
    settings: opts.settings ?? settings,
    hash: sha1Hex,
    log: opts.log,
  });
}

async function seedNote(path: string, body: string) {
  await writeFile(vault, path, `---\ntitle: ${path}\n---\n${body}`, {
    ctime: fixedNow,
    mtime: fixedNow,
    hash: sha1Hex,
    settings,
  });
}

beforeEach(async () => {
  vault = new PouchDB('c-vault' + seq, { adapter: 'memory' }) as unknown as DocStore;
  cache = new PouchDB('c-cache' + seq++, { adapter: 'memory' }) as unknown as DocStore;
  embedBatches = [];
  await seedNote('Brain Dump/2026-08-21-plants.md', 'Watering the plants on the windowsill.');
  await seedNote('Brain Dump/2026-08-21-taxes.md', 'The taxes are due in April.');
});

describe('the embedding cache, through Retrieve', () => {
  it('embeds the vault on a cold cache and not again on a warm one', async () => {
    const embedder = cachingEmbedder();

    await retrieve('what about plants?', { db: vault, settings, embedder, answerer });
    const cold = embeddedTexts().length;
    expect(cold).toBeGreaterThan(0);

    embedBatches = [];
    await retrieve('what about plants?', { db: vault, settings, embedder, answerer });

    // Same question, same vault, nothing changed: nothing should reach the provider.
    expect(embeddedTexts()).toEqual([]);
  });

  it('gives the same answer and citations warm as cold', async () => {
    const embedder = cachingEmbedder();
    const ask = () => retrieve('what about plants?', { db: vault, settings, embedder, answerer });

    const cold = await ask();
    const warm = await ask();

    // The whole correctness rule in one assertion: caching is a speed change, not an
    // answer change.
    expect(warm.answer).toBe(cold.answer);
    expect(warm.citations).toEqual(cold.citations);
  });

  it('embeds only the document that changed', async () => {
    const embedder = cachingEmbedder();
    await retrieve('what about plants?', { db: vault, settings, embedder, answerer });

    embedBatches = [];
    await seedNote('Brain Dump/2026-08-21-guitar.md', 'Practising guitar scales.');
    await retrieve('what about plants?', { db: vault, settings, embedder, answerer });

    // The new Note and the question are unseen; the two original Notes are not.
    const texts = embeddedTexts();
    expect(texts.some((t) => t.includes('guitar'))).toBe(true);
    expect(texts.some((t) => t.includes('windowsill'))).toBe(false);
    expect(texts.some((t) => t.includes('April'))).toBe(false);
  });

  it('re-embeds a document whose content changed', async () => {
    const embedder = cachingEmbedder();
    await retrieve('what about plants?', { db: vault, settings, embedder, answerer });

    embedBatches = [];
    // Same path, new content — the cache is keyed by content, so this must be a miss.
    await seedNote('Brain Dump/2026-08-21-plants.md', 'Repotting the plants this weekend.');
    await retrieve('what about plants?', { db: vault, settings, embedder, answerer });

    expect(embeddedTexts().some((t) => t.includes('Repotting'))).toBe(true);
  });

  it('does not serve vectors computed under a different embedder model', async () => {
    await retrieve('what about plants?', {
      db: vault,
      settings,
      embedder: cachingEmbedder(),
      answerer,
    });

    embedBatches = [];
    const other = { ...settings, embedderModel: 'some/other-embedder' };
    await retrieve('what about plants?', {
      db: vault,
      settings: other,
      embedder: cachingEmbedder({ settings: other }),
      answerer,
    });

    // Vectors from two models are not comparable; serving one for the other would corrupt
    // every similarity score while looking perfectly healthy.
    expect(embeddedTexts().length).toBeGreaterThan(0);
  });

  it('still answers correctly when the cache store fails', async () => {
    const broken = {
      get: async () => {
        throw new Error('cache unreachable');
      },
      put: async () => {
        throw new Error('cache unreachable');
      },
      allDocs: async () => {
        throw new Error('cache unreachable');
      },
    } as unknown as DocStore;

    const withCache = await retrieve('what about plants?', {
      db: vault,
      settings,
      embedder: cachingEmbedder(),
      answerer,
    });

    embedBatches = [];
    const withBrokenCache = await retrieve('what about plants?', {
      db: vault,
      settings,
      embedder: cachingEmbedder({ store: broken }),
      answerer,
    });

    // Degrades to speed, never to correctness.
    expect(withBrokenCache.answer).toBe(withCache.answer);
    expect(withBrokenCache.citations).toEqual(withCache.citations);
    expect(embeddedTexts().length).toBeGreaterThan(0);
  });

  it('records a failed cache write in the diagnostics log', async () => {
    const store = createLog();
    const writeOnlyBroken = {
      get: async () => {
        throw new Error('missing');
      },
      put: async () => {
        throw new Error('disk full');
      },
      allDocs: async () => ({ rows: [] }), // reads fine, everything a miss
    } as unknown as DocStore;

    await retrieve('what about plants?', {
      db: vault,
      settings,
      embedder: cachingEmbedder({ store: writeOnlyBroken, log: store.log }),
      answerer,
    });

    // A silently disabled cache is worse than a slow one, so the failure must be visible.
    const failure = store.events().find((e) => e.level === 'error' && e.op === 'embed');
    expect(failure?.message).toContain('could not cache');
  });

  it('embeds normally when no cache store is configured', async () => {
    const result = await retrieve('what about plants?', {
      db: vault,
      settings,
      embedder: cachingEmbedder({ store: undefined }),
      answerer,
    });

    expect(embeddedTexts().length).toBeGreaterThan(0);
    expect(result.citations.length).toBeGreaterThan(0);
  });
});

describe('vector encoding', () => {
  it('round-trips values that float32 represents exactly', () => {
    const vector = [0, 1, -1, 0.5, 0.25, -0.75];
    expect(decodeVector(encodeVector(vector))).toEqual(vector);
  });

  it('preserves length and stays close for values it must round', () => {
    const vector = [0.123456789, -0.987654321, 1e-8];
    const back = decodeVector(encodeVector(vector));

    // float32 keeps ~7 significant digits. This is a rounding, not a bit-identical
    // round-trip — the module comment explains why that is the accepted trade-off.
    expect(back).toHaveLength(vector.length);
    for (const [i, v] of vector.entries()) expect(back[i]).toBeCloseTo(v, 6);
  });

  it('encodes to roughly four bytes per dimension', () => {
    const encoded = encodeVector(new Array(1536).fill(0.1));
    // base64 is 4/3 of the raw bytes; 1536 float32 is 6144 bytes -> ~8192 characters.
    expect(encoded.length).toBeGreaterThan(8000);
    expect(encoded.length).toBeLessThan(8300);
  });
});

describe('cache reads are batched', () => {
  /** Counts how the cache talks to its store, so "one request for the batch" is a tested
   *  property rather than an intention. */
  function countingStore(inner: DocStore) {
    const counts = { get: 0, allDocs: 0 };
    const store = {
      get: async (id: string) => {
        counts.get++;
        return inner.get(id);
      },
      put: async (doc: Record<string, unknown>) => inner.put(doc),
      allDocs: async (opts?: Record<string, unknown>) => {
        counts.allDocs++;
        return inner.allDocs(opts as never);
      },
    } as unknown as DocStore;
    return { store, counts };
  }

  it('asks once for the whole batch instead of once per document', async () => {
    const { store, counts } = countingStore(cache);
    const embedder = cachingEmbedder({ store });

    await retrieve('what about plants?', { db: vault, settings, embedder, answerer });

    // Retrieve embeds every vault document plus the question. Per-document reads would mean a
    // round trip each — thousands on a real vault, and a 404 in the console for every miss.
    expect(counts.get).toBe(0);
    expect(counts.allDocs).toBeLessThanOrEqual(2); // one per embed() call: docs, then question
  });

  it('reads once again when warm, and embeds nothing', async () => {
    const { store, counts } = countingStore(cache);
    const embedder = cachingEmbedder({ store });
    const ask = () => retrieve('what about plants?', { db: vault, settings, embedder, answerer });

    await ask();
    embedBatches = [];
    const before = counts.allDocs;
    await ask();

    expect(embeddedTexts()).toEqual([]);
    expect(counts.get).toBe(0);
    expect(counts.allDocs - before).toBeLessThanOrEqual(2);
  });
});

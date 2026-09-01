// rankBySimilarity's embed-call fallback (related-notes ticket 04): the vault is embedded
// in one batched call, and that call is only ever one oversized document away from a 400
// that would otherwise kill the whole ranking — silently emptying Related and breaking
// Retrieve. These tests assert on the rankings the two callers observe and on what the
// diagnostics log records — never on the embedder's internals.
//
// The fake embedder is controlled by failure rules, so each test decides precisely which
// calls fail: the batch only, one named document even alone, or everything.
import { describe, it, expect } from 'vitest';
import { rankBySimilarity } from '../src/lib/vault-search';
import type { Embedder, VaultDoc } from '../src/lib/types';
import type { Log, LogInput } from '../src/lib/logger';

const doc = (path: string, body: string): VaultDoc => ({ path, title: path, content: body });

// Two dimensions: 1 in the first when the text mentions 'app', 1 in the second when it
// mentions 'coffee' — so a test decides exactly which documents are close to the subject.
const vectorFor = (text: string): number[] => [
  text.includes('app') ? 1 : 0,
  text.includes('coffee') ? 1 : 0,
];

interface FakeOpts {
  failBatch?: Error;
  failTexts?: string[];
}

/** An embedder with a call log (each entry is the batch size) and per-text failure rules.
 *  `failTexts` are matched as prefixes: a document whose embeddable text starts with one
 *  fails even when requested alone, the way an over-the-limit document does. */
function fakeEmbedder({ failBatch, failTexts = [] }: FakeOpts): Embedder & { batchSizes: number[] } {
  const batchSizes: number[] = [];
  return {
    batchSizes,
    embed: async (texts) => {
      batchSizes.push(texts.length);
      if (texts.length > 1 && failBatch) throw failBatch;
      return texts.map((t) => {
        if (failTexts.some((prefix) => t.startsWith(prefix))) {
          throw new Error('Embedding request failed: 400 (Invalid input: maximum input length is 8192 tokens.)');
        }
        return vectorFor(t);
      });
    },
  };
}

const recordingLog = (): { log: Log; events: LogInput[] } => {
  const events: LogInput[] = [];
  return { log: (e) => events.push(e), events };
};

describe('rankBySimilarity — embed-call fallback', () => {
  it('ranks in one batched call when the batch succeeds', async () => {
    const embedder = fakeEmbedder({});
    const ranked = await rankBySimilarity(
      'the app note',
      [doc('a.md', 'about the app'), doc('b.md', 'about coffee')],
      embedder,
    );
    expect(embedder.batchSizes).toEqual([2, 1]); // one batch, then the subject alone
    expect(ranked.map((r) => r.doc.path)).toEqual(['a.md', 'b.md']);
  });

  it('falls back to one request per document when the batch fails, and still ranks', async () => {
    const embedder = fakeEmbedder({ failBatch: new Error('Invalid input[0]: maximum input length is 8192 tokens.') });
    const { log, events } = recordingLog();
    const ranked = await rankBySimilarity(
      'the app note',
      [doc('coffee.md', 'about coffee'), doc('app.md', 'about the app')],
      embedder,
      log,
    );
    expect(ranked.map((r) => r.doc.path)).toEqual(['app.md', 'coffee.md']); // order, not input order
    expect(embedder.batchSizes).toEqual([2, 1, 1, 1]); // batch, two per-doc, subject
    expect(events.some((e) => e.message.includes('falling back to one request per document'))).toBe(true);
  });

  it('excludes a document that fails even alone, and ranks the rest', async () => {
    const embedder = fakeEmbedder({
      failBatch: new Error('Invalid input[0]: maximum input length is 8192 tokens.'),
      failTexts: ['oversized.md'],
    });
    const { log, events } = recordingLog();
    const ranked = await rankBySimilarity(
      'the app note',
      [doc('oversized.md', 'a very long document'), doc('app.md', 'about the app')],
      embedder,
      log,
    );
    expect(ranked.map((r) => r.doc.path)).toEqual(['app.md']); // oversized.md is gone, not scored 0
    const skip = events.find((e) => e.message.includes('excluded from this ranking'));
    expect(skip).toBeDefined();
    expect((skip!.detail as { path: string }).path).toBe('oversized.md');
  });

  it('returns an empty ranking — not a throw — when every document fails', async () => {
    const embedder = fakeEmbedder({
      failBatch: new Error('Invalid input[0]: maximum input length is 8192 tokens.'),
      failTexts: ['a.md', 'b.md'],
    });
    const ranked = await rankBySimilarity(
      'the app note',
      [doc('a.md', 'about the app'), doc('b.md', 'about coffee')],
      embedder,
    );
    expect(ranked).toEqual([]);
  });
});
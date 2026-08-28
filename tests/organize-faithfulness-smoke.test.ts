// Env-gated symptom regression test for dogfooding finding 03 — the Note asserts things
// the Dump never said.
//
// The deterministic guard in tests/llm-provider.test.ts checks the Organize PROMPT carries
// the faithfulness clause. This test drives the REAL model to confirm the clause actually
// stops the invention the finding documented: with a short problem-Dump, the Note body must
// not contain content not derivable from the Dump. A fake organizer cannot exercise this —
// the invention is a property of the real prompt + model — so this is the faithful seam.
//
// Opt-in and env-gated (mirrors Seam C, tests/llm-smoke.test.ts): skipped unless LLM_SMOKE=1,
// so `npm test` stays green without a live provider + key. No CouchDB needed — only the chat
// endpoint. Because a real model is non-deterministic, the assertion is "no run invents"
// across a few runs; before the finding-03 fix this went red 5/5.
//
//   set -a && source .env && set +a
//   npx vitest run tests/organize-faithfulness-smoke.test.ts
import { it, expect } from 'vitest';
import { createOrganizer } from '../src/lib/llm';
import { CATEGORIES } from '../src/lib/category';
import { DEFAULT_SETTINGS, type Settings } from '../src/lib/types';

const RUN = process.env.LLM_SMOKE === '1';

function settingsFromEnv(): Settings {
  return {
    ...DEFAULT_SETTINGS,
    llmProvider: process.env.LLM_PROVIDER || DEFAULT_SETTINGS.llmProvider,
    llmModel: process.env.LLM_MODEL || DEFAULT_SETTINGS.llmModel,
    llmApiKey: process.env.LLM_API_KEY || '',
    embedderModel: process.env.EMBEDDER_MODEL || DEFAULT_SETTINGS.embedderModel,
  };
}

// The invention detector: deterministic given the model's output. The user's symptom is
// "body contains content not derivable from the Dump." We approximate "derivable" lexically:
// a sentence is invented when most of its content words do not appear in the Dump. Faithful
// organizing restates + restructures the Dump, so its sentences overlap heavily; invented
// troubleshooting ("reset the SMC and NVRAM") barely overlaps.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'your', 'you', 'are', 'was',
  'have', 'has', 'can', 'may', 'then', 'also', 'but', 'not', 'will', 'should', 'would',
  'could', 'into', 'onto', 'over', 'under', 'about', 'after', 'before', 'between',
  'their', 'there', 'these', 'those', 'they', 'them', 'which', 'what', 'when', 'where',
  'how', 'why', 'who', 'its', 'itself', 'such', 'each', 'some', 'any', 'all', 'both',
  'more', 'most', 'other', 'than', 'too', 'very', 'just', 'only', 'here', 'been', 'being',
]);

function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

function inventedSentences(dump: string, body: string): string[] {
  const D = new Set(contentWords(dump));
  return body
    .replace(/^#+\s*/gm, '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => ({ s, cw: contentWords(s) }))
    .filter(({ cw }) => cw.length >= 5)
    .filter(({ s, cw }) => cw.filter((w) => D.has(w)).length / cw.length < 0.4)
    .map(({ s }) => s);
}

// The exact short problem-Dump from finding 03 (the macbook keyboard-battery case), which
// the finding measured at ×15 expansion with a 5-step invented guide.
const DUMP =
  'hid-battery rusak lagi, battery keyboard sekarang ga kebaca, mungkin gegara abis full restart macbook';

const RUNS = 3;

it.skipIf(!RUN)(
  'finding 03: Organize does not invent content beyond the Dump (real model)',
  async () => {
    const organizer = createOrganizer(settingsFromEnv());
    const invented: string[] = [];
    for (let i = 0; i < RUNS; i++) {
      const out = await organizer.organize(DUMP, 'text');
      const found = inventedSentences(DUMP, out.body);
      if (found.length) {
        console.log(`[run ${i + 1}] invented (${found.length}):\n` + found.map((s) => `  - ${s}`).join('\n'));
        invented.push(...found);
      }
    }
    expect(invented, 'no run should invent content beyond the Dump').toHaveLength(0);
  },
  90_000,
);

// Ticket 04, acceptance #10 — the Organize prompt now enumerates the five named Category members
// and asks for exactly one. The deterministic guard in tests/llm-provider.test.ts checks the
// PROMPT carries that enumeration; this test drives the REAL model to confirm the enumeration
// actually steers it onto the closed set — every run returns one of the five named members, not
// free text. (parseOrganizeOutput coerces any stray reply to `uncategorized`, so a run that
// returns `uncategorized` means the model did NOT pick a member — that is the failure this test
// catches: the prompt failed to constrain the model.) A fake organizer cannot exercise this.
//
//   set -a && source .env && set +a
//   npx vitest run tests/organize-faithfulness-smoke.test.ts
it.skipIf(!RUN)(
  'ticket 04: Organize returns a named Category member (real model)',
  async () => {
    const organizer = createOrganizer(settingsFromEnv());
    for (let i = 0; i < RUNS; i++) {
      const out = await organizer.organize(DUMP, 'text');
      // out.category is already coerced by parseOrganizeOutput, so `uncategorized` here means the
      // model returned a non-member — the prompt did not steer it onto the set. Assert a NAMED
      // member is returned every run.
      expect(CATEGORIES, `run ${i + 1} returned "${out.category}", not a named member`).toContain(out.category);
    }
  },
  90_000,
);
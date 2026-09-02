// Unit test for the OpenAI-compatible cloud seam in src/lib/llm.ts.
//
// llm.ts is "best-effort plumbing, not unit-tested" by convention — the Seam C smoke test
// (tests/llm-smoke.test.ts) is its verification. But the smoke test needs a live provider
// + API key, which can't run in CI or a fresh checkout. This test stubs `fetch` to pin the
// one thing that breaks silently and isn't covered otherwise: the exact OpenAI-compatible
// request shape (endpoint path, JSON-mode flag, auth) and response parsing
// (choices[0].message.content for chat; data[].embedding in index order for embeddings).
//
// The OpenAI-compatible API is the universal cloud seam: it works against OpenRouter,
// OpenAI, Groq, and local Ollama (via its /v1 compat endpoint) alike. `llmProvider` holds
// the full OpenAI-compatible base URL (e.g. https://openrouter.ai/api/v1).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { createOrganizer, createEmbedder, createAnswerer } from '../src/lib/llm';
import { CATEGORIES } from '../src/lib/category';
import type { Log, LogInput } from '../src/lib/logger';
import { DEFAULT_SETTINGS, type Settings } from '../src/lib/types';

const base = 'https://example.test/v1';
const apiKey = 'secret-key';

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    llmProvider: base,
    llmModel: 'chat-model',
    llmApiKey: apiKey,
    embedderModel: 'embed-model',
    ...overrides,
  };
}

/** A minimal fetch Response: ok + status + a JSON body. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    json: async () => body,
  } as Response;
}

/** A recording Log, so the timing lines can be asserted on. `Log` is the seam the cloud
 *  functions take, so this is the same thing the app passes — no reaching into llm.ts. */
function collectLog(): { log: Log; entries: LogInput[] } {
  const entries: LogInput[] = [];
  return { log: (e) => void entries.push(e), entries };
}

/** The one log line a call emits when it comes back — the thing this suite exists to pin. */
function resolved(entries: LogInput[]): LogInput | undefined {
  return entries.find((e) => e.message.endsWith('request resolved'));
}

/** The one log line a call emits when it does not. */
function failed(entries: LogInput[]): LogInput | undefined {
  return entries.find((e) => e.message.endsWith('request failed'));
}

/** Per-test response: the mock returns this body+status while capturing the request. */
let responseBody: unknown;
let responseStatus: number;

/** Capture the last fetch call's URL + parsed body. */
let lastUrl = '';
let lastOpts: RequestInit = {};
let fetchMock: Mock;

beforeEach(() => {
  lastUrl = '';
  lastOpts = {};
  responseBody = {};
  responseStatus = 200;
  // The implementation both captures the request and returns the per-test response, so
  // `mockResolvedValue` (which would bypass capture) is never used. Cast around vitest's
  // overloaded `fetch` spy type — we only need mockRestore + call assertions.
  fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    lastUrl = typeof input === 'string' ? input : (input as URL).toString();
    lastOpts = init ?? {};
    return jsonResponse(responseBody, responseStatus);
  }) as unknown as Mock;
});

afterEach(() => {
  fetchMock.mockRestore();
});

describe('OpenAI-compatible chat seam (createOrganizer / createAnswerer)', () => {
  it('POSTs to {base}/chat/completions with response_format json_object and Bearer auth', async () => {
    const organizeJson = JSON.stringify({
      title: 'T',
      tags: ['a'],
      category: 'C',
      summary: 'S',
      keyPoints: ['k'],
      related: [],
      body: 'B',
    });
    responseBody = { choices: [{ message: { content: organizeJson } }] };

    await createOrganizer(settings()).organize('a dump', 'text');

    expect(lastUrl).toBe(`${base}/chat/completions`);
    expect(lastOpts.method).toBe('POST');
    const headers = lastOpts.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Authorization']).toBe(`Bearer ${apiKey}`);

    const body = JSON.parse(lastOpts.body as string);
    expect(body.model).toBe('chat-model');
    expect(body.stream).toBe(false);
    expect(body.response_format).toEqual({ type: 'json_object' });
    // The message content is the built Organize prompt, which embeds the dump text.
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[0].content).toContain('a dump');
  });

  it('parses the reply from choices[0].message.content', async () => {
    const organizeJson = JSON.stringify({
      title: 'Water the basil',
      tags: ['home'],
      category: 'Home',
      summary: 'A reminder.',
      keyPoints: ['water it'],
      related: ['[[basil]]'],
      body: 'I keep forgetting.',
    });
    responseBody = { choices: [{ message: { content: organizeJson } }] };

    const out = await createOrganizer(settings()).organize('dump', 'text');
    expect(out.title).toBe('Water the basil');
    expect(out.tags).toEqual(['home']);
    expect(out.body).toBe('I keep forgetting.');
    // The model's raw `category: 'Home'` is a non-member — parseOrganizeOutput coerces it to
    // `uncategorized` at the seam (ticket 04). Lock the coercion here, not just in category.test.ts.
    expect(out.category).toBe('uncategorized');
  });

  it('throws on a non-OK response', async () => {
    responseStatus = 401;
    responseBody = { error: 'bad' };
    await expect(createOrganizer(settings()).organize('dump', 'text')).rejects.toThrow();
  });

  it('no longer asks the model for related links (the app owns Related)', async () => {
    // Related is resolved by the app — vault-ranked, judged by index, dead links impossible
    // by construction. The prompt's `related` field was dead code: every value it produced
    // was discarded. Asking for it invites the model to spend effort (and invent wikilinks)
    // on a field nothing reads (append-rework spec; ADR-0009).
    responseBody = {
      choices: [{ message: { content: JSON.stringify({
        title: 'T', tags: [], category: 'C', summary: 'S', keyPoints: [], body: 'B',
      }) } }],
    };
    await createOrganizer(settings()).organize('a short dump', 'text');
    const prompt = (JSON.parse(lastOpts.body as string).messages[0] as { content: string }).content;
    expect(prompt).not.toMatch(/^- related:/m);
  });

  it('carries the standing Instruction verbatim, after the faithfulness block and before the Dump', async () => {
    // The Instruction setting (append-rework): the user writes once how every Note is
    // organized — e.g. the language — and the app applies it to every Organize call. It
    // must reach the prompt verbatim (it is the user's own words, not a paraphrase), sit
    // after the built-in rules, and win where the two conflict: the user overriding
    // faithfulness is a deliberate act, not a leak (ADR-0009).
    const instruction = 'Always write the Note in English, regardless of the dump language.';
    responseBody = {
      choices: [{ message: { content: JSON.stringify({
        title: 'T', tags: [], category: 'C', summary: 'S', keyPoints: [], body: 'B',
      }) } }],
    };
    await createOrganizer(settings({ organizeInstruction: instruction })).organize('a short dump', 'text');
    const prompt = (JSON.parse(lastOpts.body as string).messages[0] as { content: string }).content;
    expect(prompt).toContain(instruction);
    // After the built-in rules, before the Dump content.
    expect(prompt.indexOf('leave something out')).toBeLessThan(prompt.indexOf(instruction));
    expect(prompt.indexOf(instruction)).toBeLessThan(prompt.indexOf('Dump content:'));
    // And the override is stated, not just implied by ordering.
    expect(prompt).toMatch(/overrides|takes precedence/i);
  });

  it('says nothing about an Instruction when none is set', async () => {
    responseBody = {
      choices: [{ message: { content: JSON.stringify({
        title: 'T', tags: [], category: 'C', summary: 'S', keyPoints: [], body: 'B',
      }) } }],
    };
    await createOrganizer(settings({ organizeInstruction: '' })).organize('a short dump', 'text');
    const prompt = (JSON.parse(lastOpts.body as string).messages[0] as { content: string }).content;
    expect(prompt).not.toMatch(/instruction/i);
  });

  it('instructs the model to be faithful to the Dump (finding 03 guard)', async () => {
    // CONTEXT.md's Organize contract: "Every part of this is derived from the Dump alone
    // except the related links." The prompt must say so to the model — without it, given a
    // short problem-Dump the model invents troubleshooting, causes and recommendations the
    // user never wrote (dogfooding finding 03: 6 of 8 Notes). This guard locks the clause in
    // the prompt so a future edit that drops it fails `npm test` without needing a live key.
    // A rephrase is fine; dropping the contract is not — assert the load-bearing intent only.
    responseBody = {
      choices: [{ message: { content: JSON.stringify({
        title: 'T', tags: [], category: 'C', summary: 'S', keyPoints: [], related: [], body: 'B',
      }) } }],
    };
    await createOrganizer(settings()).organize('a short dump', 'text');
    const prompt = (JSON.parse(lastOpts.body as string).messages[0] as { content: string }).content;
    expect(prompt).toContain('ONLY from the Dump');
    expect(prompt).toMatch(/do not add|invent/i);
  });

  it('enumerates the closed Category set and asks for exactly one (ticket 04 guard)', async () => {
    // Category is a closed set (ticket 04; spec.md §Category) so colour can mean something: the
    // model must pick one of the five named members rather than mint a free-form Category. The
    // prompt must list the members and constrain the reply to exactly one — without it the Vault
    // re-accumulates one Category per card and colour conveys nothing again. A rephrase is fine;
    // dropping the enumeration or the "exactly one" constraint is not — assert the load-bearing
    // intent only. (Coercion in parseOrganizeOutput is the total backstop; this guard locks the
    // prompt so the model is steered toward a member in the first place.)
    responseBody = {
      choices: [{ message: { content: JSON.stringify({
        title: 'T', tags: [], category: 'C', summary: 'S', keyPoints: [], related: [], body: 'B',
      }) } }],
    };
    await createOrganizer(settings()).organize('a short dump', 'text');
    const prompt = (JSON.parse(lastOpts.body as string).messages[0] as { content: string }).content;
    // Iterate CATEGORIES (the source of truth) so the guard stays correct when a member is
    // appended — the prompt is built from the same list, so a drift fails here.
    for (const member of CATEGORIES) {
      expect(prompt).toContain(member);
    }
    expect(prompt).toMatch(/exactly one/i);
  });
});

describe('OpenAI-compatible embedder seam (createEmbedder)', () => {
  it('POSTs to {base}/embeddings with {model, input} and parses data[].embedding', async () => {
    const v0 = [0.1, 0.2, 0.3];
    const v1 = [0.4, 0.5, 0.6];
    responseBody = {
      data: [
        { embedding: v1, index: 1 },
        { embedding: v0, index: 0 },
      ],
    };

    const vectors = await createEmbedder(settings()).embed(['doc one', 'doc two']);

    expect(lastUrl).toBe(`${base}/embeddings`);
    expect(lastOpts.method).toBe('POST');
    const headers = lastOpts.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${apiKey}`);
    const body = JSON.parse(lastOpts.body as string);
    expect(body.model).toBe('embed-model');
    expect(body.input).toEqual(['doc one', 'doc two']);
    // Vectors are returned in index order, not response order — a reorder would otherwise
    // mis-rank the vault against the question.
    expect(vectors).toEqual([v0, v1]);
  });

  it('returns [] for an empty input batch (no call made)', async () => {
    const vectors = await createEmbedder(settings()).embed([]);
    expect(vectors).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// The durable log used to record only that a request *started*, so every latency figure in
// dogfooding finding 09 had to be reconstructed by subtracting timestamps of adjacent,
// unrelated lines — arithmetic that cannot separate a slow model from a slow vault read, and
// cannot see reasoning tokens at all. These pin the resolve/failure lines that replace it.
// The `ms` value itself is never asserted (it is wall-clock); the contract is that it is
// there, is a number, and carries whatever the provider said about tokens.
describe('call timing and usage are recorded (capture-latency ticket 01)', () => {
  const organizeReply = JSON.stringify({
    title: 'T', tags: [], category: 'C', summary: 'S', keyPoints: [], body: 'B',
  });

  it('logs a resolved line with elapsed ms and the provider usage verbatim', async () => {
    const usage = { prompt_tokens: 812, completion_tokens: 260, reasoning_tokens: 1904 };
    responseBody = { choices: [{ message: { content: organizeReply } }], usage };
    const { log, entries } = collectLog();

    await createOrganizer(settings(), log).organize('a dump', 'text');

    const line = resolved(entries);
    expect(line).toBeDefined();
    expect(line!.op).toBe('http');
    expect(line!.message).toBe('chat request resolved');
    expect(typeof line!.detail!.ms).toBe('number');
    expect(line!.detail!.model).toBe('chat-model');
    // Verbatim, not mapped onto app-owned fields: reasoning_tokens is the whole point, and
    // the app must not have to know a field's name in advance to record it.
    expect(line!.detail!.usage).toEqual(usage);
  });

  it('still logs a resolved line when the provider reports no usage, without inventing zeros', async () => {
    responseBody = { choices: [{ message: { content: organizeReply } }] };
    const { log, entries } = collectLog();

    await createOrganizer(settings(), log).organize('a dump', 'text');

    const line = resolved(entries);
    expect(line).toBeDefined();
    expect(typeof line!.detail!.ms).toBe('number');
    // Absent, not zero — zeros would read as "no tokens" rather than "this provider does
    // not say".
    expect('usage' in line!.detail!).toBe(false);
  });

  it('logs elapsed ms on a non-OK response, so a slow failure is distinguishable', async () => {
    responseStatus = 500;
    responseBody = { error: 'boom' };
    const { log, entries } = collectLog();

    await expect(createOrganizer(settings(), log).organize('a dump', 'text')).rejects.toThrow();

    const line = failed(entries);
    expect(line).toBeDefined();
    expect(line!.level).toBe('error');
    expect(typeof line!.detail!.ms).toBe('number');
    expect(line!.detail!.status).toBe(500);
    expect(resolved(entries)).toBeUndefined();
  });

  it('logs a rejected fetch and rethrows it untouched', async () => {
    // The offline `Load failed` that reaches the capture path left no trace at this level at
    // all, so a dead network and a slow provider looked identical in the log.
    fetchMock.mockImplementation(async () => {
      throw new Error('Load failed');
    });
    const { log, entries } = collectLog();

    await expect(createOrganizer(settings(), log).organize('a dump', 'text')).rejects.toThrow(
      'Load failed',
    );

    const line = failed(entries);
    expect(line).toBeDefined();
    expect(line!.level).toBe('error');
    expect(typeof line!.detail!.ms).toBe('number');
    expect(line!.detail!.error).toBe('Load failed');
  });

  it('records the embedding call the same way, keeping the batch size alongside', async () => {
    const usage = { prompt_tokens: 4096, total_tokens: 4096 };
    responseBody = { data: [{ embedding: [0.1], index: 0 }, { embedding: [0.2], index: 1 }], usage };
    const { log, entries } = collectLog();

    await createEmbedder(settings(), log).embed(['one', 'two']);

    const line = resolved(entries);
    expect(line).toBeDefined();
    expect(line!.message).toBe('embedding request resolved');
    expect(typeof line!.detail!.ms).toBe('number');
    expect(line!.detail!.inputs).toBe(2);
    expect(line!.detail!.usage).toEqual(usage);
  });

  it('still logs the request line before the call, so a hang shows as a start with no end', async () => {
    responseBody = { choices: [{ message: { content: organizeReply } }] };
    const { log, entries } = collectLog();

    await createOrganizer(settings(), log).organize('a dump', 'text');

    expect(entries[0].message).toBe('chat request');
    expect(entries[0].detail!.url).toBe(`${base}/chat/completions`);
  });
});

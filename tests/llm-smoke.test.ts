// Seam C — real cloud LLM/embedder smoke test (ticket 08).
//
// Seam A tests the operation layer with deterministic fakes; Seam B pins the LiveSync
// doc-format against a real CouchDB. Seam C is the last untested external risk: the real
// cloud LLM/embedder seam — createOrganizer / createEmbedder / createAnswerer talking to
// a live OpenAI-compatible endpoint. It drives the SAME operation-layer seam as Seam A and
// B (organizeDump, retrieve) as black boxes, but wires the REAL cloud implementations +
// a real CouchDB instead of fakes + memory. No new seam; the only src/ change is ticket 09
// making the seam OpenAI-compatible (see ADR-0003).
//
// Because a real model is non-deterministic, assertions are on structure, types, and
// non-emptiness — never on exact output. The point is the integration no fake can cover:
// a real Organize, a real embedding, a real RAG answer, end to end against a real CouchDB.
//
// Opt-in and env-gated (mirrors Seam B): the whole suite is skipped unless LLM_SMOKE=1,
// so `npm test` stays green with no live LLM or CouchDB. Cloud + CouchDB config come from
// environment variables at run time, so API keys and passwords never enter the repo.
// Reuses docker-compose.smoke.yml for the throwaway CouchDB. The OpenAI-compatible API is
// universal — the same base works against OpenRouter, OpenAI, Groq, or a local Ollama
// (via its /v1 compat endpoint).
//
//   docker compose -f docker-compose.smoke.yml up -d
//   LIVESYNC_SMOKE=1 LLM_SMOKE=1 \
//     COUCHDB_URL=http://localhost:5984 COUCHDB_USER=admin COUCHDB_PASSWORD=password \
//     LLM_PROVIDER=https://openrouter.ai/api/v1 LLM_MODEL=<chat-model> LLM_API_KEY=<key> \
//     EMBEDDER_MODEL=openai/text-embedding-3-small \
//     npx vitest run tests/llm-smoke.test.ts
import { it, expect, beforeAll, afterAll } from 'vitest';
import { organizeDump } from '../src/lib/operations';
import { retrieve } from '../src/lib/retrieve';
import { createRemoteDb } from '../src/lib/db';
import { createOrganizer, createEmbedder, createAnswerer } from '../src/lib/llm';
import { readVaultFiles } from '../src/lib/livesync';
import {
  DEFAULT_SETTINGS,
  type Settings,
  type Dump,
  type Note,
  type AnswerOutput,
  type VaultDoc,
} from '../src/lib/types';
import {
  fixedHash,
  smokeDescribe,
  assertLiveSyncFile,
  type RemoteDb,
} from './_smoke-helpers';

// --- Opt-in gate ------------------------------------------------------------
// Skip unless the caller opts into the real-LLM smoke test. Default `npm test` never
// needs a live LLM or CouchDB and must stay green without them.
const SMOKE = process.env.LLM_SMOKE === '1';

// Real-cloud + CouchDB config from the environment. The provider defaults to OpenRouter
// (override LLM_PROVIDER for OpenAI, Groq, or http://localhost:11434/v1 for a local
// Ollama — the OpenAI-compatible API is universal). The chat + embedder models have no
// default: they must be supplied via env (they're account-specific), as the run command in
// the header shows. Secrets stay in the caller's shell.
const LLM_PROVIDER = process.env.LLM_PROVIDER ?? 'https://openrouter.ai/api/v1';
const LLM_MODEL = process.env.LLM_MODEL ?? '';
const LLM_API_KEY = process.env.LLM_API_KEY ?? '';
const EMBEDDER_MODEL = process.env.EMBEDDER_MODEL ?? '';
const COUCHDB_URL = process.env.COUCHDB_URL ?? 'http://localhost:5984';
const COUCHDB_USER = process.env.COUCHDB_USER ?? 'admin';
const COUCHDB_PASSWORD = process.env.COUCHDB_PASSWORD ?? 'password';
const COUCHDB_DB = process.env.COUCHDB_DB ?? 'brain-dump-llm-smoke';

// Real LLM calls can be slow (a cloud chat model); allow generous per-test time.
const TIMEOUT = 90_000;

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  couchdbUrl: COUCHDB_URL,
  couchdbDb: COUCHDB_DB,
  couchdbUser: COUCHDB_USER,
  couchdbPassword: COUCHDB_PASSWORD,
  dumpsFolder: '_dumps',
  managedFolder: 'Brain Dump',
  caseSensitive: false,
  hashAlgorithm: 'sha1',
  llmProvider: LLM_PROVIDER,
  llmModel: LLM_MODEL,
  llmApiKey: LLM_API_KEY,
  embedderModel: EMBEDDER_MODEL,
};

const fixedNow = Date.UTC(2026, 7, 21, 20, 30, 45); // 2026-08-21 20:30:45 UTC
const fixedId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const captureText = 'I keep forgetting to water the basil on the windowsill.';
const question = 'What do I keep forgetting to water?';

// The Dump fed to the real Organizer in both the isolated Organizer test and the full
// loop — defined once so the two Organize runs are identical inputs.
const sampleDump: Dump = {
  id: fixedId,
  content: captureText,
  context: '',
  createdAt: fixedNow,
  modality: 'text',
};

const describeSmoke = smokeDescribe(SMOKE);

let db: RemoteDb;

describeSmoke('Real cloud LLM/embedder smoke test (Seam C — ticket 08)', () => {
  beforeAll(async () => {
    // Start from a clean throwaway database so a previous run can't satisfy assertions.
    db = createRemoteDb(settings) as unknown as RemoteDb;
    await db.destroy().catch(() => undefined);
    db = createRemoteDb(settings) as unknown as RemoteDb;
  }, TIMEOUT);

  afterAll(async () => {
    await db.destroy().catch(() => undefined);
  }, TIMEOUT);

  // --- The three cloud seams, each in isolation --------------------------------

  it('the real Organizer returns a well-typed, non-empty OrganizeOutput', async () => {
    const result = await organizeDump(sampleDump, {
      db,
      settings,
      organizer: createOrganizer(settings),
      hash: fixedHash,
    });

    const out: Note = result.note;
    // Every field present and correctly typed; non-empty where the operation layer
    // depends on it (title drives the filename; tags/category/summary drive the UI).
    expect(typeof out.title).toBe('string');
    expect(out.title.length).toBeGreaterThan(0);
    expect(Array.isArray(out.tags)).toBe(true);
    expect(out.tags.length).toBeGreaterThan(0);
    expect(out.tags.every((t) => typeof t === 'string')).toBe(true);
    expect(typeof out.category).toBe('string');
    expect(out.category.length).toBeGreaterThan(0);
    expect(typeof out.summary).toBe('string');
    expect(out.summary.length).toBeGreaterThan(0);
    expect(Array.isArray(out.keyPoints)).toBe(true);
    expect(out.keyPoints.length).toBeGreaterThan(0);
    expect(out.keyPoints.every((p) => typeof p === 'string')).toBe(true);
    expect(Array.isArray(out.related)).toBe(true);
    expect(out.related.length).toBeGreaterThan(0);
    expect(out.related.every((r) => typeof r === 'string')).toBe(true);
    expect(typeof out.body).toBe('string');
    expect(out.body.length).toBeGreaterThan(0);

    // The Note written through the real Organizer lands in the real CouchDB in the
    // LiveSync doc-format (metadata + chunk docs) — the real Organize→write path is
    // verified end-to-end (story 14), not just the model reply.
    const { leaf } = await assertLiveSyncFile(db, result, { ctime: fixedNow });
    expect(leaf.data).toContain(out.title);
  }, TIMEOUT);

  it('the real Embedder returns equal-length numeric vectors for every document and the question', async () => {
    const embedder = createEmbedder(settings);
    // Every vault document AND the question — Retrieve ranks docs against the question by
    // cosine similarity, so a dimension mismatch between any doc and the question would
    // break ranking. The question is the last entry so the cross-length checks cover it.
    const vectors = await embedder.embed([
      `${captureText}`,
      'A totally different topic: filing taxes.',
      'A third unrelated note about guitar practice.',
      question,
    ]);

    expect(Array.isArray(vectors)).toBe(true);
    expect(vectors.length).toBe(4);
    for (const v of vectors) {
      expect(Array.isArray(v)).toBe(true);
      expect(v.length).toBeGreaterThan(0); // a real embedding has a non-trivial dimension
      expect(v.every((x) => typeof x === 'number' && Number.isFinite(x))).toBe(true);
    }
    // Equal dimension across every input (docs and the question) is what cosine
    // similarity depends on — a mismatch here is the failure this test catches.
    const dim = vectors[0].length;
    for (const v of vectors) {
      expect(v.length).toBe(dim);
    }
  }, TIMEOUT);

  it('the real Answerer returns a non-empty answer and in-range source indexes', async () => {
    const answerer = createAnswerer(settings);
    const sources: VaultDoc[] = [
      {
        path: 'Brain Dump/2026-08-21-water-the-basil.md',
        title: 'Water the basil',
        content: `${captureText}\n\n## Summary\n\nA reminder to water the basil.`,
      },
    ];
    const out: AnswerOutput = await answerer.answer(question, sources);

    expect(typeof out.answer).toBe('string');
    expect(out.answer.length).toBeGreaterThan(0);
    expect(Array.isArray(out.sources)).toBe(true);
    // Every named source is a valid index into the docs the Answerer was given; invented
    // indexes here would become dead citations downstream.
    for (const i of out.sources) {
      expect(Number.isInteger(i)).toBe(true);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(sources.length);
    }
  }, TIMEOUT);

  // --- The full loop: the integration no fake can cover -------------------------

  it('the full loop: real Organize → Note in CouchDB → real Retrieve → answer + citations', async () => {
    // 1. Organize with the real Organizer, writing the Note to the real CouchDB.
    const written = await organizeDump(sampleDump, {
      db,
      settings,
      organizer: createOrganizer(settings),
      hash: fixedHash,
    });

    // 2. Retrieve a question whose answer should draw on that Note, with the real
    //    Embedder + Answerer over the real CouchDB vault.
    const result = await retrieve(question, {
      db,
      settings,
      embedder: createEmbedder(settings),
      answerer: createAnswerer(settings),
    });

    // The answer is a real, non-empty string synthesized from the vault.
    expect(typeof result.answer).toBe('string');
    expect(result.answer.length).toBeGreaterThan(0);

    // Naming nothing is a valid answer ("I couldn't find that"), so citations may be
    // empty — but a citation that DOES appear must not be a dead link: its path must be
    // a file actually in the vault. This is the contract the operation layer enforces and
    // the one a real model is most likely to violate by inventing a path.
    const vaultPaths = new Set(
      (await readVaultFiles(db, () => true)).map((f) => f.path),
    );
    for (const c of result.citations) {
      expect(vaultPaths.has(c.path)).toBe(true);
    }
    // The Note we just wrote is in the vault and therefore retrievable — the loop really
    // ran end to end, not against an empty vault.
    expect(vaultPaths.has(written.path)).toBe(true);
  }, TIMEOUT);
});
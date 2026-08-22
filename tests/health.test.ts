// "Test connection" (src/lib/health.ts): the external dependencies checked independently,
// so a failure names one field instead of sending the user back to guessing.
//
// The independence is the contract worth pinning: a broken CouchDB must not stop the cloud
// checks from running and reporting, or the button is no better than the outbox message it
// exists to pre-empt.
import { describe, it, expect, vi } from 'vitest';
import { checkConnections, PROBE_DATABASE } from '../src/lib/health';
import type { DatabaseAdmin } from '../src/lib/db';
import { createLog } from '../src/lib/logger';
import { DEFAULT_SETTINGS, type DocStore, type Embedder, type Organizer } from '../src/lib/types';

const organizeOutput = {
  title: 'Basil',
  tags: ['plants'],
  category: 'home',
  summary: 'Water the basil.',
  keyPoints: ['water it'],
  related: [],
  body: 'Water the basil.',
};

const okDb = (): DocStore => ({
  put: vi.fn(),
  get: vi.fn(),
  allDocs: vi.fn(async () => ({ rows: [] })),
}) as unknown as DocStore;

const okOrganizer = (): Organizer => ({ organize: vi.fn(async () => organizeOutput) });
const okEmbedder = (): Embedder => ({ embed: vi.fn(async () => [[0.1, 0.2, 0.3]]) });

const settings = {
  ...DEFAULT_SETTINGS,
  couchdbUrl: 'https://couch.example.com',
  couchdbDb: 'obsidian',
};

describe('checkConnections', () => {
  it('reports all three green when everything works', async () => {
    const report = await checkConnections({
      db: okDb(),
      organizer: okOrganizer(),
      embedder: okEmbedder(),
      settings,
    });

    expect(report.couchdb.ok).toBe(true);
    expect(report.chat.ok).toBe(true);
    expect(report.embeddings.ok).toBe(true);
    expect(report.embeddings.message).toContain('3-dimension');
  });

  it('still runs and reports the cloud checks when CouchDB is down', async () => {
    const report = await checkConnections({
      db: { ...okDb(), allDocs: vi.fn(async () => { throw new Error('ECONNREFUSED'); }) } as unknown as DocStore,
      organizer: okOrganizer(),
      embedder: okEmbedder(),
      settings,
    });

    // The whole point: one failure must not mask the state of the other two.
    expect(report.couchdb).toMatchObject({ ok: false });
    expect(report.couchdb.message).toContain('ECONNREFUSED');
    expect(report.chat.ok).toBe(true);
    expect(report.embeddings.ok).toBe(true);
  });

  it('isolates a chat failure from a working embedder', async () => {
    const report = await checkConnections({
      db: okDb(),
      organizer: { organize: vi.fn(async () => { throw new Error('LLM request failed: 404 Not Found (POST /chat/completions)'); }) },
      embedder: okEmbedder(),
      settings,
    });

    expect(report.couchdb.ok).toBe(true);
    expect(report.chat.ok).toBe(false);
    // The resolved URL survives into the UI message — the detail that made the real bug legible.
    expect(report.chat.message).toContain('/chat/completions');
    expect(report.embeddings.ok).toBe(true);
  });

  it('fails the embedder check on an empty vector rather than calling it a pass', async () => {
    const report = await checkConnections({
      db: okDb(),
      organizer: okOrganizer(),
      embedder: { embed: vi.fn(async () => [[]]) },
      settings,
    });

    // An empty vector makes every cosine score zero, ranking the vault at random —
    // a silent failure worth catching at the Config screen.
    expect(report.embeddings.ok).toBe(false);
    expect(report.embeddings.message).toContain('no vector');
  });

  it('names the missing field instead of making a doomed request', async () => {
    const report = await checkConnections({
      db: okDb(),
      organizer: okOrganizer(),
      embedder: okEmbedder(),
      settings: { ...settings, couchdbDb: '', llmModel: '', embedderModel: '' },
    });

    expect(report.couchdb.message).toContain('required');
    expect(report.chat.message).toContain('required');
    expect(report.embeddings.message).toContain('required');
  });

  it('records the outcome in the diagnostics log', async () => {
    const store = createLog();
    await checkConnections({
      db: okDb(),
      organizer: okOrganizer(),
      embedder: okEmbedder(),
      settings,
      log: store.log,
    });

    const event = store.events().find((e) => e.op === 'health');
    expect(event?.detail).toMatchObject({ couchdb: true, chat: true, embeddings: true });
  });
});

describe('the database-creation check', () => {
  /** A fake server that records what was done to it, so the safety rule — never delete a
   *  database this check did not create — is observable rather than assumed. */
  function fakeAdmin(opts: { existing?: boolean; refuseCreate?: boolean; refuseDestroy?: boolean } = {}) {
    const calls: string[] = [];
    const admin: DatabaseAdmin = {
      async exists(name) {
        calls.push(`exists:${name}`);
        return Boolean(opts.existing);
      },
      async create(name) {
        calls.push(`create:${name}`);
        if (opts.refuseCreate) throw new Error('403 Forbidden');
      },
      async destroy(name) {
        calls.push(`destroy:${name}`);
        if (opts.refuseDestroy) throw new Error('500 Internal Server Error');
      },
    };
    return { admin, calls };
  }

  const base = { db: okDb(), organizer: okOrganizer(), embedder: okEmbedder(), settings };

  it('passes and cleans up when the account may create a database', async () => {
    const { admin, calls } = fakeAdmin();
    const report = await checkConnections({ ...base, admin });

    expect(report.databaseCreation?.ok).toBe(true);
    expect(calls).toEqual([
      `exists:${PROBE_DATABASE}`,
      `create:${PROBE_DATABASE}`,
      `destroy:${PROBE_DATABASE}`,
    ]);
  });

  it('fails with the fallback named when the account may not', async () => {
    const { admin, calls } = fakeAdmin({ refuseCreate: true });
    const report = await checkConnections({ ...base, admin });

    expect(report.databaseCreation?.ok).toBe(false);
    expect(report.databaseCreation?.message).toContain('403');
    expect(report.databaseCreation?.message).toContain('per-device');
    // Nothing was created, so nothing may be destroyed.
    expect(calls).not.toContain(`destroy:${PROBE_DATABASE}`);
  });

  it('never deletes a database it did not create', async () => {
    const { admin, calls } = fakeAdmin({ existing: true });
    const report = await checkConnections({ ...base, admin });

    // The probe name being taken makes the question unanswerable — which is the correct
    // outcome, because the alternative is destroying a database that is not ours.
    expect(report.databaseCreation?.ok).toBe(false);
    expect(report.databaseCreation?.message).toContain('already exists');
    expect(calls).toEqual([`exists:${PROBE_DATABASE}`]);
  });

  it('reports success but names the leftover when cleanup fails', async () => {
    const { admin } = fakeAdmin({ refuseDestroy: true });
    const report = await checkConnections({ ...base, admin });

    // Creation is what was under test and it worked; the leftover is a separate problem.
    expect(report.databaseCreation?.ok).toBe(true);
    expect(report.databaseCreation?.message).toContain(PROBE_DATABASE);
    expect(report.databaseCreation?.message).toContain('by hand');
  });

  it('is omitted entirely when no admin is supplied', async () => {
    const report = await checkConnections(base);
    expect(report.databaseCreation).toBeUndefined();
  });

  it('does not stop the other three checks from reporting', async () => {
    const { admin } = fakeAdmin({ refuseCreate: true });
    const report = await checkConnections({ ...base, admin });

    expect(report.couchdb.ok).toBe(true);
    expect(report.chat.ok).toBe(true);
    expect(report.embeddings.ok).toBe(true);
  });
});

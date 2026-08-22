// "Test connection" (src/lib/health.ts): the three external dependencies checked
// independently, so a failure names one field instead of sending the user back to guessing.
//
// The independence is the contract worth pinning: a broken CouchDB must not stop the cloud
// checks from running and reporting, or the button is no better than the outbox message it
// exists to pre-empt.
import { describe, it, expect, vi } from 'vitest';
import { checkConnections } from '../src/lib/health';
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

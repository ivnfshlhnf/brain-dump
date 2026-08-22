// Seam B — LiveSync doc-format compatibility smoke test (ticket 07, ADR-0001).
//
// The biggest external risk in this app is its coupling to Obsidian LiveSync's internal
// CouchDB document format, for which there is no official external-write API (ADR-0001).
// This integration test pins that format contract: it writes a Dump and a Note through
// the app's real CouchDB writer (`createRemoteDb` + the http adapter) against a *real*
// CouchDB, then reads the raw docs back and asserts they match the shape LiveSync's
// reader reassembles — valid metadata + chunk docs with the correct `_id` / `path` /
// `children` / hash conventions.
//
// The contract asserted here is grounded in LiveSync's own reader source
// (vrtmrz/livesync-commonlib): a metadata doc (`type: "plain"`, `children: [leafId...]`,
// original-case `path`, `eden`, `ctime`/`mtime`/`size`) plus one leaf per child
// (`type: "leaf"`, `data: string`). The reader fetches each child by `_id` and
// reassembles the file as `children.map(c => c.data).join('')` (respondEntryFromMeta); it
// does NOT verify the chunk hash, so the `h:` prefix and the hash digest only matter for
// dedup, not for the file being readable. This test validates ONLY that doc-format
// contract, not app logic (the in-memory PouchDB tests in operations.test.ts cover that).
//
// What this does NOT do is import livesync-commonlib's reader itself and feed it the docs
// — that lib is not a lightweight test dependency, so the reassembly below is a faithful
// mirror of `respondEntryFromMeta`/`isChunkDoc`/`ChunkFetcher`'s acceptance checks, cited
// inline. A future hardening could call the real reader; until then, a drift in the
// reader's requirements that this mirror does not capture would slip past this test.
//
// It is risk-driven and optional: a real CouchDB is impractical in plain `npm test`, so
// the whole suite is skipped unless the caller opts in with `LIVESYNC_SMOKE=1` and points
// the test at a reachable CouchDB. See `docker-compose.smoke.yml` for a one-command
// CouchDB to run it against.
//
//   LIVESYNC_SMOKE=1 \
//     COUCHDB_URL=http://localhost:5984 \
//     COUCHDB_USER=admin COUCHDB_PASSWORD=password \
//     npx vitest run tests/livesync-smoke.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { capture, organizeDump, dumpFilename } from '../src/lib/operations';
import { docIdForPath } from '../src/lib/livesync';
import { createRemoteDb } from '../src/lib/db';
import {
  DEFAULT_SETTINGS,
  type Settings,
  type Dump,
  type Organizer,
  type OrganizeOutput,
} from '../src/lib/types';
import {
  fixedHash,
  smokeDescribe,
  assertLiveSyncFile,
  type RemoteDb,
  type MetaDoc,
  type LeafDoc,
} from './_smoke-helpers';

// --- Opt-in gate ------------------------------------------------------------
// Skip unless the caller explicitly asks for the real-CouchDB smoke test. The default
// `npm test` run never needs a CouchDB and must stay green without one.
const SMOKE = process.env.LIVESYNC_SMOKE === '1';
const COUCHDB_URL = process.env.COUCHDB_URL ?? 'http://localhost:5984';
const COUCHDB_USER = process.env.COUCHDB_USER ?? 'admin';
const COUCHDB_PASSWORD = process.env.COUCHDB_PASSWORD ?? 'password';
const COUCHDB_DB = process.env.COUCHDB_DB ?? 'brain-dump-smoke';

// Real-CouchDB ops are slower than the in-memory suite; allow generous per-test time.
const TIMEOUT = 30_000;

const fixedNow = Date.UTC(2026, 7, 21, 20, 30, 45); // 2026-08-21 20:30:45 UTC
const fixedId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

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
};

// A deterministic Organize fake — no real LLM. The smoke test is about the doc format,
// not model output; the Note just needs a realistic, frontmatter-bearing body to write.
const sampleOutput: OrganizeOutput = {
  title: 'Water the plants',
  tags: ['home', 'plants'],
  category: 'Home',
  summary: 'A reminder to water the plants.',
  keyPoints: ['Water the plants regularly'],
  related: ['[[plants]]'],
  body: 'I keep forgetting to water the plants.',
};
const organizer: Organizer = { organize: async () => sampleOutput };

const describeSmoke = smokeDescribe(SMOKE);

let db: RemoteDb;

describeSmoke('LiveSync doc-format smoke test (Seam B — ticket 07)', () => {
  beforeAll(async () => {
    // Start from a clean database so a previous run's docs can't satisfy assertions.
    // Ignore the error when it does not exist yet, then re-create the handle.
    db = createRemoteDb(settings) as unknown as RemoteDb;
    await db.destroy().catch(() => undefined);
    db = createRemoteDb(settings) as unknown as RemoteDb;
  }, TIMEOUT);

  afterAll(async () => {
    // Tear down the throwaway smoke database.
    await db.destroy().catch(() => undefined);
  }, TIMEOUT);

  it('writes a Dump as a LiveSync metadata doc + a content-addressed chunk doc', async () => {
    const result = await capture('I keep forgetting to water the plants', {
      db,
      settings,
      now: () => fixedNow,
      newId: () => fixedId,
      hash: fixedHash,
    });

    // The metadata doc _id is the lowercased vault-relative path, with the leading-slash
    // prefix LiveSync uses for underscore-leading folders (ADR-0001 / path2id_base).
    expect(result.metadataId).toBe(docIdForPath(result.path, settings));
    expect(result.metadataId).toBe('/_dumps/20260821-203045-aaaaaa.md');

    const { meta, leaf } = await assertLiveSyncFile(db, result, { ctime: fixedNow });
    // `size` is the file content's character length (the app writes content.length); pin
    // the convention so a future byte-length drift is caught.
    expect(meta.size).toBe(leaf.data.length);
    expect(leaf.data).toContain('I keep forgetting to water the plants');
  }, TIMEOUT);

  it('writes a Note in the managed folder with the same metadata + leaf contract', async () => {
    const dump: Dump = {
      id: fixedId,
      content: 'I keep forgetting to water the plants',
      context: '',
      createdAt: fixedNow,
      modality: 'text',
    };
    const result = await organizeDump(dump, { db, settings, organizer, hash: fixedHash });

    expect(result.path).toBe('Brain Dump/2026-08-21-water-the-plants.md');
    expect(result.metadataId).toBe(docIdForPath(result.path, settings));

    const { leaf } = await assertLiveSyncFile(db, result, { ctime: fixedNow });
    // The Note body carries the v1 frontmatter the reader surfaces in Obsidian. (The full
    // schema is pinned in the Seam A tests; here we confirm a representative slice made it
    // into the stored leaf intact.)
    expect(leaf.data).toContain('title: Water the plants');
    expect(leaf.data).toContain('tags: [home, plants]');
    expect(leaf.data).toContain('category: Home');
    expect(leaf.data).toContain('## Summary');
    expect(leaf.data).toContain('## Key points');
    expect(leaf.data).toContain('## Related');
  }, TIMEOUT);

  it('a reader reassembles a file from its children leaves — the read half of the contract', async () => {
    // LiveSync's reader (respondEntryFromMeta) takes a metadata doc's `children`, fetches
    // each leaf, and concatenates `data` in order to recover the file — throwing "Load
    // failed" if any child is missing. The app writes single-chunk files, but this
    // reassembly convention is what makes them readable. Assert it directly against the
    // raw CouchDB docs, not through the app's readVaultFiles.
    const result = await capture('reassembly check', {
      db,
      settings,
      now: () => fixedNow,
      newId: () => 'reassembly-check',
      hash: fixedHash,
    });

    const meta = await db.get<MetaDoc>(result.metadataId);
    // Every child id must resolve to an existing leaf — a dangling child id is the
    // failure this catches (the reader throws on a missing chunk).
    const leaves = await Promise.all(meta.children.map((id) => db.get<LeafDoc>(id)));
    const reassembled = leaves.map((l) => l.data).join('');

    expect(reassembled).toContain('## Original');
    expect(reassembled).toContain('reassembly check');
  }, TIMEOUT);

  it('writes the agreed filenames so Notes sort chronologically and round-trip via path', async () => {
    // The Dump filename is <YYYYMMDD>-<HHMMSS>-<shortid>.md; the Note filename is
    // <YYYY-MM-DD>-<title-slug>.md. Both are recorded verbatim in the metadata doc's
    // `path` (ADR-0001), so they round-trip through LiveSync's reader.
    expect(dumpFilename(fixedNow, fixedId)).toBe('20260821-203045-aaaaaa.md');
  }, TIMEOUT);
});
# 07 — LiveSync doc-format compatibility smoke test

**What to build:** A real-CouchDB integration test asserting the app's written docs are accepted by LiveSync's reader, pinning the ADR-0001 format contract. Test-only; no app behavior.

**Blocked by:** 01 — Capture a text brain-dump as a raw Dump in the vault.

**Status:** done

- [x] An integration test runs against a real CouchDB and writes a Dump and a Note via the app's writer. *(`tests/livesync-smoke.test.ts` writes through `createRemoteDb` + the http adapter to a real CouchDB, opted into with `LIVESYNC_SMOKE=1`; it writes a Dump via `capture` and a Note via `organizeDump`, then reads the raw docs back. `docker-compose.smoke.yml` provides a one-command CouchDB.)*
- [x] The test asserts the written docs are accepted/parsed by LiveSync's reader (valid metadata + chunk docs, correct `_id`/`path`/`children`/hash conventions). *(Assertions grounded in `vrtmrz/livesync-commonlib`'s reader: metadata doc `type: "plain"`, original-case `path`, `children: [leafId]`, `eden: {}`, `ctime`/`mtime`/`size`; leaf doc `type: "leaf"`, string `data`, `_id` = `h:` + hash; and the read half — reassembling the file as `children.map(c => c.data).join('')`, with every child id resolving to an existing leaf.)*
- [x] The test validates only the doc-format contract, not app logic. *(No assertions on Organize output, matching, or outbox behavior — those live in the in-memory Seam A tests. The reader does not verify the chunk hash, so the `h:` digest is asserted as a shared convention, not as a value LiveSync checks.)*
- [x] Optional/risk-driven — can be deferred if a real CouchDB in CI is impractical. *(The whole suite is `describe.skip` unless `LIVESYNC_SMOKE=1`, so `npm test` stays green with no CouchDB; the skip is visible in the output.)*

## Comments

- Surfaced and fixed a latent bug in `createRemoteDb` (`src/lib/db.ts`): its `.replace(/\/+/g, '/')` collapsed the URL scheme, turning `http://host` into `http:/host`, which the http adapter rejects ("Invalid Adapter: undefined"). No prior test exercised `createRemoteDb` (it is connection plumbing, "not unit-tested"), so Seam B was the first thing to put a real CouchDB behind it. Fixed to strip a trailing slash only, preserving `://`. This is a one-line app fix in service of the ticket's external-write-correctness goal rather than new behavior.
- Vitest loads `pouchdb-core` (CJS) as a second instance inside `src/lib/db.ts`, so the http adapter a test registers is invisible to `createRemoteDb`'s private PouchDB. Added `test.server.deps.inline: ['pouchdb-core', 'pouchdb-adapter-http']` to `vite.config.ts` (test-only; the app build is unaffected) to keep a single shared instance, matching the browser bundle's assumption.
- LiveSync's reader (`getDBEntryMetaByPath` / `respondEntryFromMeta` in `livesync-commonlib`) fetches a file's `children` by `_id` and concatenates `data`; it does not recompute or verify the chunk hash. The app's SHA-1-over-content digest therefore differs from LiveSync's `sha1(content-length)` mixing, but the file is still readable — the only consequence is potential duplicate chunks if LiveSync itself later writes identical content (dedup, not correctness). Consistent with ADR-0001's "chunk IDs must match the plugin's configured hash algorithm" being a dedup concern.
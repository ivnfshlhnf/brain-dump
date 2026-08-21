# 07 — LiveSync doc-format compatibility smoke test

**What to build:** A real-CouchDB integration test asserting the app's written docs are accepted by LiveSync's reader, pinning the ADR-0001 format contract. Test-only; no app behavior.

**Blocked by:** 01 — Capture a text brain-dump as a raw Dump in the vault.

**Status:** ready-for-agent

- [ ] An integration test runs against a real CouchDB and writes a Dump and a Note via the app's writer.
- [ ] The test asserts the written docs are accepted/parsed by LiveSync's reader (valid metadata + chunk docs, correct `_id`/`path`/`children`/hash conventions).
- [ ] The test validates only the doc-format contract, not app logic.
- [ ] Optional/risk-driven — can be deferred if a real CouchDB in CI is impractical.
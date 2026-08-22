# 05 — Offline outbox

**What to build:** As the user, I can capture a thought with no connection; it is queued locally and, on reconnect, synced and Organized into a Note automatically.

**Blocked by:** 02 — Organize a Dump into a Note.

**Status:** done

- [x] A Capture with no connection saves the Dump to an IndexedDB outbox and shows "saved, will organize when online," with no preview. *(`captureOrQueue` returns a `queued` outcome carrying `OFFLINE_CAPTURE_MESSAGE`; nothing is written to CouchDB and no review session opens, since Organize is an online-time step. The store is `createIndexedDbOutbox` in `outbox.ts`, which queues Dumps themselves and shares the app's IndexedDB database with settings via `idb.ts`.)*
- [x] On reconnect, queued Dumps sync to CouchDB and are Organized into Notes. *(`drainOutbox` syncs then Organizes each queued Dump, oldest capture first; the app drains on the `online` event, at startup, and on a 60s retry timer while the queue is non-empty — a capture that failed while already online never fires `online`. An unattended drain founds a new Note — appending needs the user's one-tap confirm from ticket 04.)*
- [x] The Dump is never lost while offline. *(The queue is durable IndexedDB. A Dump is removed only after its Note is written, so a failed drain leaves it queued. A capture that starts online and fails mid-flight falls back to the outbox, reusing the same Dump id and capture time so the retry rewrites one file rather than creating a second — that outcome is reported as `capture-failed` with the underlying error, never as "offline", because the user is not.)*
- [x] Tests cover offline capture (queued, no Note), reconnect (sync + Organize → Note produced), and outbox durability. *(`tests/outbox.test.ts`, 11 tests: offline capture queues with no vault write, online capture still previews, empty capture rejected not queued, mid-flight failure falls back to the queue with the honest `capture-failed` reason and error, that fallback drains without duplicating the Dump, drain syncs + Organizes with capture-time filenames, FIFO drain, no-op while offline, failed Organize keeps the Dump queued and succeeds on the next drain, and durability across a fresh outbox handle over the same IndexedDB — driven against `fake-indexeddb`, i.e. real IndexedDB semantics.)*

## Comments

- The queued Dump carries the capture time, so the synced Dump and Note are dated by when the thought occurred, not when the connection returned.
- `idb.ts` bumps the app database to version 2 (settings + outbox), creating stores only when missing so an existing v1 database upgrades cleanly.
- **Known consequence:** a Dump captured offline can never Append (story 11) — the drain is unattended and appending needs the user's one-tap confirm, so it always founds a new Note. An offline thought related to an existing Note therefore lands separately, and nothing reconciles it later. Revisit if offline capture turns out to be common; the explicit metadata refresh from ticket 04 is the nearest existing remedy.
- Reviewed on the Standards and Spec axes; fixes applied for glossary drift (`OutboxEntry` → queue `Dump` itself), the duplicated empty-capture guard, unused optional deps, the missing retry path for a capture that failed while online, the false "offline" message on an online failure, and a swallowed outbox read error.

# 05 — Offline outbox

**What to build:** As the user, I can capture a thought with no connection; it is queued locally and, on reconnect, synced and Organized into a Note automatically.

**Blocked by:** 02 — Organize a Dump into a Note.

**Status:** ready-for-agent

- [ ] A Capture with no connection saves the Dump to an IndexedDB outbox and shows "saved, will organize when online," with no preview.
- [ ] On reconnect, queued Dumps sync to CouchDB and are Organized into Notes.
- [ ] The Dump is never lost while offline.
- [ ] Tests cover offline capture (queued, no Note), reconnect (sync + Organize → Note produced), and outbox durability.
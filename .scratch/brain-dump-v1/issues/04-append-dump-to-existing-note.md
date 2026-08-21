# 04 — Append a Dump to an existing Note

**What to build:** As the user, when my new Dump is related to an existing Note, the app suggests appending to it; on confirm, the Dump is added as a new dated section without overwriting my edits, and a save conflict is retried. Matching is LLM-assisted (by tags/topic); embedding-based matching is deferred until Retrieve (06) lands.

**Blocked by:** 03 — Capture review flow: Note preview, Context, autosave.

**Status:** ready-for-agent

- [ ] A new Dump is matched to an existing Note (LLM-assisted, by tags/topic), and the user confirms new Note vs append to the suggested Note with one action.
- [ ] Appending adds a new dated section to the Note body.
- [ ] The app never overwrites the user's existing edits to the Note body.
- [ ] The app uses optimistic concurrency: write with the current CouchDB `_rev`; on a 409 conflict, re-fetch, re-apply the append, and retry.
- [ ] Metadata refresh (re-deriving title/tags/summary) is explicit and user-triggered, never automatic.
- [ ] Tests cover the match-and-confirm, the dated-section append, edit preservation, and the 409 retry.
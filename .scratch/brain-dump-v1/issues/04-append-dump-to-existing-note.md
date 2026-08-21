# 04 — Append a Dump to an existing Note

**What to build:** As the user, when my new Dump is related to an existing Note, the app suggests appending to it; on confirm, the Dump is added as a new dated section without overwriting my edits, and a save conflict is retried. Matching is LLM-assisted (by tags/topic); embedding-based matching is deferred until Retrieve (06) lands.

**Blocked by:** 03 — Capture review flow: Note preview, Context, autosave.

**Status:** done

- [x] A new Dump is matched to an existing Note (LLM-assisted, by tags/topic), and the user confirms new Note vs append to the suggested Note with one action. *(Matching via `matchNote` + the `Matcher` seam (`createMatcher` in the cloud LLM); `beginCapture` offers new-vs-append. Append is held until the user confirms with one tap — the 5s autosave no-ops an unconfirmed append rather than silently appending; "Save as new Note" overrides to new.)*
- [x] Appending adds a new dated section to the Note body. *(`appendDumpToNote` appends a `## Appended <stamp>` section — dated by the Dump's capture time, the meaningful date of the content; the append action's time is the file `mtime`.)*
- [x] The app never overwrites the user's existing edits to the Note body. *(Append is a body transform on the freshest content; the frontmatter is left untouched.)*
- [x] The app uses optimistic concurrency: write with the current CouchDB `_rev`; on a 409 conflict, re-fetch, re-apply the append, and retry. *(`modifyFile` in `livesync.ts` — read-modify-write with the known `_rev`, re-fetch + re-apply on 409, up to 5 attempts.)*
- [x] Metadata refresh (re-deriving title/tags/summary) is explicit and user-triggered, never automatic. *(`refreshNoteMetadata` is wired only to the explicit "Refresh metadata" button; the append never calls it. The Organize runs once per refresh, cached across 409 retries.)*
- [x] Tests cover the match-and-confirm, the dated-section append, edit preservation, and the 409 retry. *(`tests/append.test.ts`: match-and-confirm, dated-section append, edit preservation, 409 retry with concurrent edit preserved, append does-not-auto-refresh, override-to-new, explicit refresh, and refresh-organizes-once-under-retry.)*
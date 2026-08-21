# 03 — Capture review flow: Note preview, Context, autosave

**What to build:** As the user, after capturing I see a preview of the organized **Note**, I can add **Context** that edits my Dump while preserving the verbatim original, and the Note is finalized and saved on a 5-second inactivity auto-save (or on close), after which the Dump is frozen.

**Blocked by:** 02 — Organize a Dump into a Note.

**Status:** ready-for-agent

- [ ] After the initial Organize, the Note preview is shown on one screen alongside the new-vs-append match decision.
- [ ] The user can add Context, which edits the Dump; the verbatim original is preserved inside the Dump (e.g. a `## Original` section).
- [ ] The preview holds the initial Organize while Context is added (no live re-organize per keystroke).
- [ ] A final Organize runs over the full Dump (original + Context) at the 5s inactivity auto-save.
- [ ] The Note is also saved on `beforeunload` (close before auto-save).
- [ ] Once the Note is saved, the Dump is frozen and immutable.
- [ ] If the final save fails, the Dump persists and the Note is generated from it later.
- [ ] Tests cover Context-add preserving the original, the autosave timing, the final re-organize, the beforeunload save, and Dump immutability after save.
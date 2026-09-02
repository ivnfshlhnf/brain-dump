**Status:** ready

# 04 — Related is computed for the preview, not at save

**What to build:** Run the Related pass during the preview and render its links there. Reuse
them at save when no Context was added. Give the pass a 5s deadline.

**Blocked by:** 03 — both change when the autosave timer is armed, and this extends 03's rule.

## Problem Statement

Two problems, one cause.

**The save is a dead screen.** `finalizeCapture` → `foundNewNote` runs `withRelated` — a full
vault read, an embedding batch, a subject embedding, and a judge chat — *before* `writeNote`.
Logged at 3.8s, 4.5s, 4.8s and 20.2s. The sheet stays open for all of it with nothing
changing: the countdown edge drained to nothing at the 5s mark, the buttons stay enabled, no
spinner appears. The file the user is waiting for is the last thing that happens.

**The user approves a Note they do not get.** The preview renders a Related section that
always reads `Links are found when the Note is saved` (`App.svelte:1479-1484`), because
`session.preview.related` comes from Organize, which has never seen the Vault. The app then
writes links the user never saw. `foundNewNote`'s own comment states the opposite guarantee
for every other field: *"the Note the user approved is the Note that gets saved."*

Placing Related at save was deliberate — the related-notes spec says *"Computed at final save,
not at capture… the capture preview deliberately shows no related links"*, to keep the capture
path instant. That reasoning inverted: nothing stayed instant, and the wait landed at the
moment with the least feedback.

## Solution

Run the Related pass during the preview, after Organize resolves, and render its result in the
section that already exists. The placeholder becomes a resolving state, then the links.

At save, reuse them under exactly the condition `foundNewNote` already reuses the preview
Organize:

```js
// today
const organized = session.dump.context ? await organizeNote(...) : session.preview;
const note = await withRelated(organized, session, deps);   // always

// after
const note = session.dump.context
  ? await withRelated(organized, session, deps)   // the Note changed; recompute
  : organized;                                    // the preview already carries them
```

One `if (context)` shape now governs both fields. Adding Context re-organizes the Note, so its
links no longer describe it and are recomputed — that path keeps its save-time wait, honestly.
The Append path is untouched: it re-organizes the target wholesale from the merged Dump, so a
preview's links describe a different Note entirely.

**A 5s deadline.** Past it the autosave timer is armed anyway and the Note is filed without
links, with the section saying so. The app's promise is *put it down and it files itself*;
that promise must not become conditional on a network call. This extends a rule `related.ts`
already states — *"losing the links is a far better outcome than losing the Note."*

## User Stories

1. As the user, I want the Note I approve to be the Note that gets saved, links included, so
   that nothing reaches my vault that I never saw.
2. As the user, I want the Related links to appear while I am reading the preview, so that
   the waiting happens where I am already looking.
3. As the user, I want saving to be quick once I have decided, so that filing is the end of
   the interaction rather than another wait.
4. As the user, I want a slow or failed Related pass to cost me links and never the Note, so
   that a network problem cannot strand a thought.
5. As the user, I want to see that links are still being found, so that an empty section
   during the wait does not read as "nothing connects here".
6. As the user, I want links recomputed when I add Context, so that they describe the finished
   thought rather than the first draft.

## Implementation Decisions

- **`findRelated` is unchanged and is called earlier.** It already takes its dependencies
  explicitly and already returns wikilinks; nothing about the ranking, the floor, the cap, or
  the judge changes.
- **`excludePath` for a founding preview is the not-yet-existing path**, as it already is on
  the founding path today.
- **The links live on the session's preview Note**, which is the object `foundNewNote` already
  reuses. No parallel state.
- **The deadline is on the app's wait for the pass, not a `fetch` abort.** A pass that lands
  after the deadline but before the save is still used; one that lands after the save is
  discarded. Racing the write would be worse than losing the links.
- **A deadline miss and a failure render the same way** — the section says links could not be
  found now — and both are logged. From the user's side they are the same event.
- **Related runs for previews that are never saved.** Accepted, and stated so it is not
  mistaken for an oversight: deferring it until the save is certain puts it back on the save
  path and defeats the ticket. At personal-vault scale the cost is fractions of a cent.
- **The Append path keeps its save-time Related pass** and its 44 seconds. Out of scope.
- **The timer rule from 03 extends:** arm the clock once Match *and* Related have settled, or
  the deadline has passed.

## Testing Decisions

- **Seam A, with a Relater fake that resolves on demand** — the suite must be able to express
  "the preview exists and its links do not yet".
- **The reuse property is the core assertion:** with no Context added, finalizing makes
  **zero** Relater calls and the written Note carries the preview's links. With Context added,
  it makes exactly one, and the written Note carries the recomputed links.
- **The deadline property:** a Relater that never resolves still produces a filed Note, with
  an empty Related section, within the deadline plus the autosave delay.
- **A Relater that rejects behaves identically** to one that times out, from the written
  Note's perspective.
- **The dead-link guarantee still holds** on the new path: every link written corresponds to a
  document in the fake vault.
- **"No reverse links" must still hold** — no document other than the new Note is written
  during finalize. This property is why it was written as a test rather than an intention.
- The related-notes suites must pass unchanged wherever they assert on outcomes rather than
  on when the pass ran.

## Out of Scope

- The Append path's Related placement and its 44 seconds.
- Recovery's missing Related pass — ticket 05.
- What the sheet does after the save fires — ticket 06.
- Any change to ranking, floor, cap, embedder, or the judge prompt.

**Status:** ready

# 05 — Recovery computes Related

**What to build:** Give `recoverPending` the Related pass it has never had, so a Note founded
from a Pending Dump lands with links like any other.

**Blocked by:** nothing structurally. Sequenced after 04 so both paths adopt the rule at once.

## Problem Statement

`recoverPending` (`src/lib/operations.ts:1533`) organizes and writes:

```js
const note = await organizeNote(dump, deps.organizer, deps.settings);
const noteWrite = await writeNote(note, deps.db, deps.settings, deps.hash);
```

There is no Related pass anywhere in it. **Every Note founded by recovery lands with an empty
`## Related` by construction** — and recovery is the path every offline Capture takes. The
phone with no signal is the arc this app exists for, so the one path that most needs its
thoughts reconnected is the only path that never reconnects them.

This is finding 08's first loss point, recorded on 2026-09-01 and still open: tickets 03 and
04 of the related-notes thread fixed the judge's prompt and the oversized-document hazard, and
the recovery gap was explicitly deferred pending a decision. The sting recorded in the finding
is that the recovery rule's own comment (`operations.ts:1258`) says *"Related is what
reconnects the two"* when an offline capture is founded as a separate Note — so the
reconnection the design leans on is the one thing recovery never computes.

Both offline Notes from the 08-31 session are this. One of them has a single link only because
a later user-triggered Re-organize ran the path that does call `fillRelated`.

## Solution

Compute Related in `recoverPending` between the Organize and the write, the way the founding
path does.

This is the other half of ADR-0010's rule. Related runs where the wait is free: in the preview
the user is reading, and in recovery **nobody is watching at all** — it runs on a timer,
against Dumps the user has already put down. Recovery is the one place where a blocking call
costs nothing, which makes it the one place the pass should stay exactly where it is.

Ticket 04 moves Related off the save path for the user's sake. Leaving recovery out would make
the rule hold on the path with a user and fail on the path without one.

Recovery already degrades gracefully around missing dependencies, and Related keeps its
existing best-effort contract: no embedder or judge means no links, and a failed pass logs and
writes the Note anyway. A recovered Note without links is the current behaviour and remains an
acceptable outcome; a recovered Note that fails to be written because the judge was
unreachable would not be.

## User Stories

1. As the user, I want a Note recovered from an offline capture to have Related links, so that
   capturing without signal is not a second-class path.
2. As the user, I want recovery to still file the Note when links cannot be found, so that a
   reconnection failure never costs me the thought.
3. As the user, I want recovery to keep working when the app is configured without an embedder
   or judge, so that Related is an enhancement and not a dependency.

## Implementation Decisions

- **The same helper the founding path uses**, with the same best-effort contract. Two
  definitions of "compute the Related links" would be free to drift, and a drift here is
  invisible — links would still look plausible while the two paths quietly disagreed.
- **No deadline here.** Ticket 04's 5s deadline exists because a user is waiting on a
  countdown; in recovery nobody is, and cutting the pass short would trade the ticket's entire
  benefit for a saving nobody experiences.
- **`excludePath` is the Note's own path**, so a re-run cannot rank the Note as its own
  closest match.
- **Recovery's existing failure handling is unchanged.** A Dump that fails repeatedly still
  becomes Stranded; this ticket must not add a new way for recovery to fail.
- **Notes already filed with an empty section are not backfilled.** The user can Re-organize a
  Note, which already runs the path that computes links.

## Testing Decisions

- **Seam A, driving recovery with fakes** — the existing recovery suites are the pattern.
- **The core assertion:** a Pending Dump recovered with an embedder and judge present produces
  a Note carrying links, and those links point at documents in the fake vault.
- **The degradation assertions, which matter more than the happy path here:** recovery with no
  embedder or judge still writes the Note, with an empty section; a Relater that rejects still
  writes the Note; neither case leaves the Dump Pending.
- **Pin that recovery still marks the Dump no longer Pending** in every one of those cases —
  the failure this ticket could introduce is a Dump that stays Pending because the links
  failed.
- Existing recovery and stranded-dump suites must pass unchanged.

## Out of Scope

- Backfilling Notes that already landed with an empty `## Related`.
- Any change to ranking, floor, cap, embedder, or judge prompt.
- The Append path.

**Status:** unblocked — 01 and 02 are done; the Host is live and the PWA loads on the phone
(2026-08-31). Checklist below.

# 03 — Phone verification against the real Host

**What to verify:** The whole thread, on the phone, against the real Host — the environment
only reality provides (phone, tunnel, iOS PWA quirks). No automated seam here by decision.

**Blocked by:** 01 — shell on the Host; 02 — persistent log and export.

## Checklist (run in order, record results in this file)

1. **Cold start with the Mac asleep** (the headline): put the Mac to sleep. Close the PWA on
   the phone, reopen it. The shell paints from precache. Record: yes/no, any first-paint
   oddity.

   **Result (2026-08-31): pass.** Shell painted, no oddity reported.

2. **Offline capture → Pending → recovery:** with the Mac asleep (or Tailscale off), capture
   a real thought. It enrolls as Pending. Reconnect, reopen — the Dump organizes into its
   Note. Record the log of the whole arc.

   **Result (2026-08-31): BUG FOUND and diagnosed — it was the grid, not recovery.** The
   airplane-mode variant exposed a real failure with a happy engine: the phone's exported
   log shows the whole arc SUCCEEDING (`recovery started due:1` → `Note written, Dump no
   longer Pending` → `recovery finished {organized:1}`, 21s end to end). The Note landed on
   the Vault. What failed was the running session's view: `onOnline` fired `recover()` and
   `enterGrid()` concurrently, so the grid read predates the recovery write, and recovery
   afterward touched only the Pending strip and a status line. The Note appeared only after
   the user closed and reopened the app. Fixed in App.svelte: recovery that files or
   dequeues anything now refreshes the grid; regression check
   `scripts/check-recovery-refresh.mjs` (red without the fix, green with it, wired into
   npm test).
3. **Log persistence:** while a failure is reproducible, close and reopen the app, open
   Settings — the events are still listed. Export; the download is one JSON object per line.
   Paste-compare against `logs/brain-dump.jsonl` format. Record: byte-comparable or not.
4. **Export on iOS:** do blob downloads work from the standalone PWA? If not, fall back to
   Copy-of-JSONL and record the decision in ticket 02.
5. **Update pickup (lazy):** change something visible, build, rsync to the volume, open the
   PWA twice (iOS updates SW on navigation). The Settings version line names the new commit.
   Record: how many reloads it took.
6. **Clear:** wipe the persisted log after export; confirm the retained set is empty.
7. **The origin switch ledger:** confirm any Dump stranded by the reinstall surface — run
   Find stranded Dumps once and record its counts. This is the deliberate backstop for the
   Pending store not carrying over; now is when it is least hypothetical.

## Notes

- Capture a *real* thought for item 2, not a throwaway — per the dogfooding findings, a
  throwaway dump produces no title worth comparing.
- After this ticket, any failure found on the phone has an evidence path that works with no
  dev server involved: the persistent log, exported as the format the dev log already uses.
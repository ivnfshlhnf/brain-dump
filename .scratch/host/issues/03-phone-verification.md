**Status:** COMPLETE (2026-09-01) — all items pass on the real device; the one stranded
Dump found by item 7 was Organized. One observed rough edge recorded under item 2
(capture lingers ~35s when the network claims online but is dead) — parked as ticket 04.

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

   **Re-verified on hardware (2026-09-01): pass.** After the fix reached the phone, the
   same arc showed the Note appear in the *running* grid on reconnect — no close/reopen.
   One observation, not a failure: the capture sheet lingered before returning to the
   grid — the exported log shows why (dump `faf0fefe`, 04:51 UTC): the phone claimed
   online, so the capture went down the online path (enrolled `in-flight`) and waited
   34.7s for the OpenRouter call to fail with `Load failed` before the Pending receipt
   showed. When the network lies, the honest path costs the full request timeout; the
   Dump still enrolled and organized correctly (recovery `04:53:02` → Note
   `04:53:44`, `organized:1`).
3. **Log persistence:** while a failure is reproducible, close and reopen the app, open
   Settings — the events are still listed. Export; the download is one JSON object per line.
   Paste-compare against `logs/brain-dump.jsonl` format. Record: byte-comparable or not.

   **Result (2026-09-01): pass.** The last 81 events listed in Settings before and after a
   full close/reopen; the exported file (`logs/brain-dump-log-2026-09-01.jsonl.ndjson`)
   has exactly 81 lines, every one a valid single-line JSON object with
   `at`/`level`/`op`/`message`, and the op vocabulary matches the dev log
   (`config`/`http`/`health`/`capture`/`pending`/`recover`/`embed`/`related`/`reconcile`).
   Byte-comparable.
4. **Export on iOS:** do blob downloads work from the standalone PWA? If not, fall back to
   Copy-of-JSONL and record the decision in ticket 02.

   **Result (2026-09-01): download works.** The blob download surfaced a file from the
   standalone PWA on iOS — no Copy fallback needed (decision recorded in ticket 02).
5. **Update pickup (lazy):** change something visible, build, rsync to the volume, open the
   PWA twice (iOS updates SW on navigation). The Settings version line names the new commit.
   Record: how many reloads it took. There is now also a manual action — Settings → "Check
   for updates" — which fetches the newest worker on press and reloads into it if it claims
   right away (`src/lib/sw-update.ts`; added after item 5's first run found the phone pinned
   to a stale sw.js).

   **Result (2026-08-31): pass, after fixing two layers of edge starvation.** The phone sat
   pinned to 3a6700b across several app reopens and even though the origin's index.html
   already referenced the new bundle (verified by cache-miss probe: `cf-cache-status: MISS`,
   new asset hash). Two causes stack: (1) Caddy serves `sw.js`/`registerSW.js` with no
   Cache-Control, so Cloudflare applied its default 4h edge TTL and kept answering HIT with
   a stale worker — fixed by the e11d81f Caddyfile `no-cache` headers, which required a
   one-time **container restart** (Caddy reads config at start; dist/ alone never needs one);
   (2) the already-cached edge copy needed **Purge Everything** (domain → Caching →
   Configuration; index.html was never edge-cached — CF marks HTML `DYNAMIC`). After
   restart + purge, the phone picked up e67eaec on the next app open. From here, deploys
   are pure rsync — no purge, no restart.

   **Button on-device (2026-09-01): pass.** Settings → "Check for updates" answered
   "This is the latest build." in under a second.

   **Follow-up (2026-09-01): that pass only exercised the nothing-newer path.** After the
   next deploy, the button on the phone answered "This is the latest build." while a
   newer build sat at the Host — the reopen served it at once. Root cause: the decision
   read `registration.installing` alone, one snapshot after `await registration.update()`.
   The worker calls skipWaiting as soon as it evaluates and a LAN precache finishes in
   well under a second, so by the time WebKit resolves `update()` the worker has moved
   past `installing` — null read as "nothing found", and the claim (which had already
   fired `controllerchange`) went unanswered. Chromium resolves `update()` earlier, so
   desktop passed by timing luck. Fix in `src/lib/sw-update.ts`: an update is "found"
   if the worker is `installing`, `waiting`, or has already claimed (controller identity
   changed) — any of the phases it can have reached when the promise resolves. Ordering
   pinned by tests/update-check.test.ts; the found-an-update path now also has a
   real-browser check (scripts/check-update-pickup.mjs, in `npm test`), which deploys a
   second build under the running page and requires the press to land in it.

   **Second follow-up (2026-09-01): an applied press dumped the user on the grid.** Once
   the fix above was live, every found-update press reloaded the document — and the
   reload starts from the grid, stranding the user who pressed inside the Settings
   sheet. The reload itself is the update applying (the running document cannot swap to
   the new build in place); what was missing was the press's *place* riding across it.
   Fix: `runUpdateCheck` leaves a sessionStorage mark before reloading; boot consumes it
   and reopens the Settings sheet (`UPDATE_SHEET_KEY`, App.svelte) — session-scoped, so
   closing and reopening the app later still boots the grid. Pinned by the same check's
   "applied press keeps the Settings sheet open" assertion. Third pass (same day): the
   restored sheet also answers — the press's status line died with the old document, so
   the reopened sheet was a silent blink; boot now sets "This is the latest build."
   alongside the reopen (the reload just landed on the newest build), pinned by "the
   restored sheet answers for the applied update" in the check. Fourth pass (same day):
   the restored sheet also keeps the press's scroll — the version block lives at the
   foot and a fresh dialog opens at scrollTop 0, so the answer rendered below the fold;
   the mark now carries the `.sheet__body` offset and boot restores it after the dialog
   renders, pinned by "opens scrolled to the version block" (check runs at a phone
   viewport, where the sheet actually overflows).

   **Closing correction (2026-09-01, same day): the apply-in-place design above is
   superseded — the button is now check-only, by the user's decision.** The chain of
   reload-restore fixes (sheet restore → message restore → scroll restore) was each
   patching the previous patch, because a reload is inherently destructive of the
   moment; the question that ended it was "why should it reopen the sheet, it's only
   checking the latest build, right?" The final design: the press fetches and downloads
   the newest worker and reports on the spot — "Update downloaded — it takes over when
   you reopen the app." — and *never* reloads. The sheet never closes, nothing scrolls,
   and the found update serves on the next app reopen exactly like the lazy path
   (`registerType: 'autoUpdate'` claims it as soon as the worker evaluates). The whole
   UPDATE_SHEET_KEY/restore machinery was deleted from App.svelte; `sw-update.ts` now
   returns pending/current/unavailable with no 'applied'. Every paragraph in the two
   follow-ups above that mentions a reload, a restore, or a scroll mark describes
   removed code; the misreport fix itself (found = installing || waiting || controller
   changed) stands unchanged underneath it. Pinned by tests/update-check.test.ts and
   `scripts/check-update-pickup.mjs`, whose contract is now: no reload during the press,
   sheet stays open, reopen serves the second build.

   **Review pass (2026-09-01, same day): the pins hardened, two dead references removed.**
   The two-axis review of the working tree found the check's own reload watch ending at
   the answer (a late reload would have passed) and the reopen asserted via `page.reload()`
   — a reload proxy, not a reopen. The check now keeps watching for a load event after the
   answer ("never reloads" is the whole contract, not just during the press) and reopens
   through a fresh page in the same context (same install, new document — closer to what
   iOS's reopen means). Both promise-returning `waitForFunction` calls (the anti-pattern
   the check itself documents) became hand-rolled polls. The stale scroll-overflow comment
   from the deleted fourth pass is gone. Repo-wide, the Node gate and the IndexedDB seeding
   every check copy-pasted moved into `scripts/lib/check-harness.mjs`, and `npm test`'s
   hand-maintained chain of checks became `scripts/run-checks.mjs` (alphabetical walk;
   each check is hermetic, so order was never load-bearing).
6. **Clear:** wipe the persisted log after export; confirm the retained set is empty.

   **Result (2026-09-01): pass.** The list emptied and stayed empty after a close/reopen.
7. **The origin switch ledger:** confirm any Dump stranded by the reinstall surface — run
   Find stranded Dumps once and record its counts. This is the deliberate backstop for the
   Pending store not carrying over; now is when it is least hypothetical.

   **Result (2026-09-01): 1 stranded Dump — Organized.** The backstop was not
   hypothetical: exactly one Dump never became a Note, and the user Organized it from the
   sheet (2026-09-01), so it became its Note. Item closed; the Host spec is verified end
   to end.

## Notes

- Capture a *real* thought for item 2, not a throwaway — per the dogfooding findings, a
  throwaway dump produces no title worth comparing.
- After this ticket, any failure found on the phone has an evidence path that works with no
  dev server involved: the persistent log, exported as the format the dev log already uses.
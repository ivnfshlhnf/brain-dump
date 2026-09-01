**Status:** checklist complete (2026-09-01) — items 1–6 pass on the real device; item 7 found
1 stranded Dump, awaiting the Organize/Dismiss decision in the sheet. One observed rough
edge recorded under item 2 (capture lingers ~35s when the network claims online but is
dead) — candidate for a future ticket, not blocking.

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
6. **Clear:** wipe the persisted log after export; confirm the retained set is empty.

   **Result (2026-09-01): pass.** The list emptied and stayed empty after a close/reopen.
7. **The origin switch ledger:** confirm any Dump stranded by the reinstall surface — run
   Find stranded Dumps once and record its counts. This is the deliberate backstop for the
   Pending store not carrying over; now is when it is least hypothetical.

   **Result (2026-09-01): 1 stranded Dump.** The backstop was not hypothetical: exactly one
   Dump never became a Note. Decide in the sheet: Organize (it was a real thought) or
   Dismiss.

## Notes

- Capture a *real* thought for item 2, not a throwaway — per the dogfooding findings, a
  throwaway dump produces no title worth comparing.
- After this ticket, any failure found on the phone has an evidence path that works with no
  dev server involved: the persistent log, exported as the format the dev log already uses.
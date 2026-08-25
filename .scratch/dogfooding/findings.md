# Dogfooding findings

A running list of things noticed while actually using the app. Newest last.

Each entry records only what was **observed** — deliberately no "cause" or "fix" field.
Diagnosis happens later, in a spec, once a pattern is visible. Filing a cause at
observation time is how you end up fixing the wrong thing: the obvious explanations for
empty `## Related` were all plausible and all wrong (`.scratch/related-notes/spec.md`).

There is no threshold that converts this list into work. The user says when.

---

## 01 — The Note preview does not match the Note in the vault

**Date:** 2026-08-23

**What I saw:** After giving a Dump, the Note preview shown in the capture review looks
different from the Note that actually ends up in the vault.

**What I expected:** The preview to show me the Note I am about to save.

**Evidence:** Three code facts that could each produce a visible difference. Which one was
responsible on any given occasion is not yet established — check which applies next time it
happens.

- `finalizeCapture` (`src/lib/operations.ts:344`) calls `organizeNote` a second time at save,
  unconditionally, including when no Context was added. It is a separate LLM call over the
  same Dump, so title, tags, summary and key points need not match the preview's.
- Related links are resolved only at save (`withRelated`, `src/lib/operations.ts:366`). The
  preview makes no embedding call and renders no `## Related` section at all.
- On the `append` path the saved result is a dated section inside an existing Note, not a
  standalone Note (`appendDumpToNote`), so it is not the same kind of document as the preview.

**Times seen:** 1

**Established since (2026-08-23, from `logs/brain-dump.jsonl`):** the second Organize is real
and runs on every capture. Each capture in the log shows a `chat request` after
`capture session ready` — a separate call from the two that preceded it. The preview's fields
and the saved Note's fields therefore come from different responses to the same Dump. What is
still unobserved is how *visibly* they differ.

**Established since (2026-08-23, from the vault and the markup):** the preview and the saved
Note are not the same kind of artifact, and this part is fully reproducible rather than
probabilistic.

- The preview block (`src/App.svelte:414-428`) renders exactly four fields: `title`, `summary`,
  `keyPoints`, `tags`.
- A saved Note contains frontmatter (title, tags, created, modality, source, category, summary),
  an H1, `body`, `## Summary`, `## Key points` and `## Related`.
- `Note.body` — described in `src/lib/types.ts:27` as the cleaned, organized content, and the
  largest part of the document — is not rendered in the preview at all. Neither is `category`,
  `source`, or `related`.
- Within a saved Note the frontmatter title and the body's H1 need not match. In
  `Brain Dump/2026-08-23-vorssaint-utils-github-repo.md` the frontmatter reads
  `title: vorssaint-utils GitHub repo` and the H1 reads `# vorssaint-utils`. The preview shows
  the frontmatter title; Obsidian shows the H1.

**Established since (2026-08-24, from the merged `ui-design` work — supersedes part of the
block above):** the *rendering* half of this finding is now stale. The design passes changed
the preview to show the whole Note, so the "preview shows four fields" observation no longer
describes the app.

- The preview now renders `title`, `tags`, `category`, `body`, `summary`, `keyPoints` **and**
  `related` (`src/App.svelte`, the `<article class="note">` block). `Note.body` is rendered —
  it was the point of the pass. Only `source` is still not shown.
- The `## Related` line is now rendered *before* save too, but honestly: it states "Links are
  found when the Note is saved" rather than showing an empty section. So the pre-save absence
  of related links is no longer a silent mismatch; it is stated.
- **Still true, and still the live part of this finding:** the second unconditional
  `organizeNote` in `finalizeCapture`. Showing more fields in the preview does not make them
  the *same* fields — it widens the surface on which the two LLM responses can disagree.
- **Still true:** the frontmatter-title vs body-H1 mismatch on
  `Brain Dump/2026-08-23-vorssaint-utils-github-repo.md`. See finding 03 for why that Note is
  the only one affected — it is the only one whose body was given an H1 at all.

**How to observe the rest, next time:** capture a real thought (not a synthetic one — a
throwaway dump produces no title worth comparing), add no Context, and screenshot the preview
immediately. The autosave timer is armed the moment the preview appears
(`src/App.svelte:143`), so there are about five seconds before the Note is written. Do not type
into Context to buy time: that rewrites the Dump and changes what the final Organize sees,
which destroys the comparison. Then compare the screenshot against the file in the vault.

---

## 02 — Dumps that never became Notes, and nothing knows they exist

**Date:** 2026-08-24

**What I saw:** The vault holds **14 Dumps and 8 Notes**. Ten Dumps are referenced by a Note
(`source:` frontmatter or an `_Source:` line in an appended section). **Four are referenced by
nothing.** The thought is in the vault and will never be Organized, and no surface in the app
or the vault says so.

```
20260823-145245-673efa  "the captured note looks slop, it added unnecessary info…"
20260824-080557-f91477  "kopi kopi yang udah lama kayak diatas sebulan…"
20260824-080638-3215d1  ← byte-identical to the above, 41s later
20260824-080652-23f61b  ← byte-identical again, 14s after that
```

**What I expected:** every Dump either founds a Note or Appends to one. Where neither happened,
I expected to be told — the whole promise is that I do not have to file anything, which only
holds if the app files everything it took.

**Evidence:**

- Reproducible from the vault alone:
  ```sh
  V=~/Documents/Obsidian/Vault
  for f in "$V"/_dumps/*.md; do b=$(basename "$f" .md);
    grep -rqF "$b" "$V/Brain Dump/" || echo "ORPHAN $b"; done
  ```
- The three coffee Dumps are byte-identical (189 bytes each, differing only in `id` and
  `created`) and span **55 seconds** — 08:05:57, 08:06:38, 08:06:52 UTC. Three separate Dump
  ids, so three separate captures, not one write retried.
- Adjacent in the timeline, from `_dumps/` itself: `20260824-081331-664c76` (08:13:31) reads
  "nyobain test brain dump app di hp ga bisa trus ada error", and `20260824-081731-8a234b`
  (08:17:31) reads "Error: Invalid Adapter: undefined". The three orphaned coffee captures fall
  ~7 minutes *before* the first of those, in the same session.
- `20260823-145245-673efa` is orphaned from a different day and a different session, so this is
  not confined to the phone.

**What held:** the raw Dump reached the vault on all four occasions, including all three
duplicate presses. Principle 1 — the thought survives whatever else fails — did its job. What
is missing is not the data; it is any knowledge that the data is stranded.

**Times seen:** 1 session reviewed; 4 orphaned Dumps found in it.

**Not yet established:** whether Organize was never invoked, invoked and failed, or succeeded
into a write that failed; and whether the repeated identical captures were the user pressing
again or the app capturing more than once per press. Deliberately not diagnosed here.

**How to observe the rest, next time:** run the orphan check above after any session that felt
wrong. If a capture appears to do nothing, note the wall-clock time before pressing again, so
the Dump timestamps can later be matched against `logs/brain-dump.jsonl`.

**Established since (2026-08-24, from a trace-replay of `logs/brain-dump.jsonl`):** the four
orphans split into two stranding windows in the capture→Organize→write flow. The log records
`capture` events carrying a `dumpId` (a UUID); the vault filename is `<createdAt>-<first 6 hex>`,
so each orphan was matched to its trace.

- **Window A — interrupted mid-Organize** (`f91477`, `3215d1`, the first two coffee Dumps): the
  log shows `capture started` plus one chat request, and **no terminal event** — no `capture
  session ready`, no `queued (offline)`, no `capture failed`. `beginCapture`
  (`src/lib/operations.ts:309`) writes the Dump first (`capture()` → `writeDump`), then fires the
  Organize chat call. An interruption there (the mobile tab backgrounded / closed, killing the
  fetch) leaves the await unresolved: `captureOrQueue`'s try/catch never fires, so the Dump is
  written but **not** added to the outbox (outbox.add only runs in the offline branch at line 667
  or the catch at 680 — neither fired). No preview appeared, so the user saw nothing happen and
  pressed again.
- **Window B — Organized, but the Note never landed** (`673efa`, `23f61b`): the log shows
  `capture session ready` (Organize succeeded, preview held), but no Note exists. The autosave
  arms a 5s timer at capture (`src/App.svelte:243`); if the app closed before it fired, or
  `finalizeCapture`'s `writeNote` failed — the same session produced a Dump reading
  `Error: Invalid Adapter: undefined` at 08:17, the broken-PouchDB-adapter state — the session
  stays unsaved and the Dump is stranded. `saveAndFinalize` *does* surface `Save failed — Dump
  kept` when finalize runs and fails, but if the app closed before the 5s timer, finalize never
  ran and nothing was surfaced.

**Zero `drain` events in the log:** the offline-recovery path (`drainOutbox`) never ran — these
were online captures that died or failed, not offline-queued ones, so the outbox never held them
and drain could not have rescued them.

**The repeated captures are a symptom, not a separate bug.** The capture button is
`disabled={busy}` during the in-flight call (`src/App.svelte:546`), so the three coffee Dumps
(55 s apart, three separate `dumpId`s) are three genuine presses, not an auto-double-trigger.
Each press followed a Window-A capture that gave no feedback it was processing — the user pressed
again because nothing told them the first one was working or had failed.

**The root cause is a durability gap, not a logic bug.** The Dump is written at capture (Principle
1 holds), but "this Dump still needs to be Organized into a Note" is **never persisted** — the
only persisted state is the Dump file itself. There is no "pending Organize" record and no
stranded-Dump detection, so any interruption between Dump-write and Note-write strands the Dump
silently, and a restart cannot find or retry it. The fix is a feature — persist the pending
state and/or detect stranded Dumps on start, and show in-progress feedback so the user does not
re-press — not a one-line change. It belongs in the main flow (spec → implement), and the
diagnosing-bugs skill stops here: the cause is established, but there is no in-process seam that
goes red on an interruption and green on a fix, so a red→green regression loop cannot be built
without the running app.

**Resolved since (2026-08-24, spec→implement via /grill-with-docs):** the durability gap is
closed. Every Dump now enrols in a **Pending** store (CONTEXT.md gained *Pending* and
*Stranded*) the moment it is Captured — online or offline, before anything can fail — and
leaves only once its Note has been written. The old outbox *was* durable, but it was only ever
written in the offline branch or the catch, and an interruption is neither: the fetch never
settles, so no catch runs.

The red test is the finding in one assertion (`tests/pending.test.ts`): start a capture whose
Organize never resolves, and look at the store while it hangs. Before the fix,
`expected [] to have a length of 1`. After it, a record with `reason: 'in-flight'`.

- **Window A** (interrupted mid-Organize): at start, `adoptInterrupted` retires the
  `in-flight` claim on any record that survived the reload — nothing that could still be
  organizing it exists — and recovery Organizes it. The retry timer deliberately never adopts,
  so a capture genuinely in flight is not raced.
- **Window B** (Organized, Note never landed): the same recovery covers it, because the record
  is only removed by `finalizeCapture` once the write returns.
- **The duplicate presses**: the draft and the textarea are now cleared the instant the Dump is
  durably Pending (`onPending`), not when the capture resolves. The text sitting in the box
  after a press that appeared to do nothing was the invitation to press again.
- **Not re-Organizing what is already filed**: a Dump cited by a Note (`source:` frontmatter or
  an appended `_Source:` line) is dequeued untouched. This matters because `noteFilename` is
  `date-slug(title)` — a second Organize can retitle, so a duplicate recovery would write a
  *second file*, not overwrite the first. Tested by killing the flow between `writeNote` and the
  dequeue.
- **Giving up honestly**: attempts back off 60s→2m→5m→15m and stop at 5. The session that
  produced `Error: Invalid Adapter: undefined` would otherwise have spun an LLM call a minute
  all day. After the cap the Dump is **Stranded**: surfaced with its error and a Retry, not
  retried.
- **The four existing orphans** are not reachable by any of that — they predate the store. They
  are found by **Find stranded Dumps** in Config, which runs the orphan check from this finding
  against the Vault. Manual on purpose: run automatically, its first act would be to spend four
  LLM calls on thoughts from August 23–24, two of which are duplicates.

Pending state is device-local, which is the one decision here worth an ADR
(`docs/adr/0005-pending-state-is-device-local.md`): CouchDB was available and rejected, because
an offline capture cannot write its own "I am offline" marker, and two devices recovering one
record race into two Notes. The Vault is the cross-device answer instead.

**Still worth watching:** whether a recovered Dump that *would* have been an Append founds a
separate Note often enough to be annoying. Recovery always founds a new Note — an unattended
Organize has nobody to confirm an Append with — and Related is supposed to reconnect the two.
Unobserved either way.

---

## 03 — The Note asserts things the Dump never said

**Date:** 2026-08-24 (first noticed 2026-08-23, in Dump `20260823-145245-673efa`)

**What I saw:** Organize does not only structure the thought — it **answers** it. Notes contain
troubleshooting steps, hypotheses, reproduction steps and recommendations that were never in
the Dump and were never in my head.

The sharpest case, `2026-08-23-macbook-keyboard-battery-issue.md`. The entire Dump was one
sentence:

> hid-battery rusak lagi, battery keyboard sekarang ga kebaca, mungkin gegara abis full restart macbook

The Note came back with a five-step guide under `## Suggested Steps`: check the Bluetooth
pairing, restart again, **reset the SMC and NVRAM**, check System Settings > Keyboard, and
**contact Apple Support or visit an authorized service provider**. None of that is mine.

**What I expected:** a title, tags, a summary, key points and links — derived from the Dump.
PRODUCT.md: "Every part of this is derived from the Dump alone except the related links."

**Evidence:**

- Expansion, measured (Dump body characters → Note file bytes):

  | Dump | body | Note | ratio |
  |---|---|---|---|
  | `20260823-102726-9a48f3` | 101 ch | 1,551 b | **×15.3** |
  | `20260824-081731-8a234b` | 143 ch | 1,787 b | **×12.4** |
  | `20260824-082714-f3347c` | 287 ch | 2,878 b | **×10.0** |

- Invented sections, by Note:
  - `macbook-keyboard-battery-issue` — `## Possible Cause`, `## Suggested Steps` (5 steps)
  - `save-failure-in-obsidian` — `## Steps to Reproduce` (5), `## Potential Causes` (3),
    `## Workaround`
  - `app-error-on-mobile`, appended section — `## Likely Cause`, `## Steps to Investigate` (5),
    `## Next Action`
  - `app-error-on-mobile` — "Further investigation needed."
  - `save-failure-in-obsidian`, appended section — `## Cause`, `## Suggested Fix`
- Some invented content is a **factual claim about the world**, not a rephrasing: SMC/NVRAM
  resets, Apple's authorised-service route, "conflict with Obsidian's internal note format
  expectations". These are the model's knowledge presented inside my own note, in my voice.
- The Note's **shape is invented too** — no two Notes share a skeleton:
  ```
  first-impressions      ## First Impressions
  config-greyed-field    ## Resolution
  note-app-insights      ## Brain-Dump Note App Reflections
  macbook-keyboard       ## Problem | ## Possible Cause | ## Suggested Steps
  vorssaint-utils        # vorssaint-utils              ← the only H1
  app-error-on-mobile    ## Issue | ## Likely Cause | ## Steps to Investigate | ## Next Action
  save-failure           ## Issue | ## Observed Behavior | ## Steps to Reproduce | …
  ui-design-reflection   (no body heading at all)
  ```
  `vorssaint-utils` being the only Note that emits an H1 is also why it is the only Note where
  the frontmatter title and the H1 can disagree — the mismatch recorded in finding 01.
- Two Notes are honest: `note-app-insights` and `ui-design-tool-reflection` mostly restate the
  Dump. Both had long, already-complete Dumps. The invention is worst where the Dump was
  shortest.

**Why this is not cosmetic:** Retrieve answers questions over these Notes and cites them as my
own past thinking. A Note that confidently recommends an SMC reset will be returned months from
now as something I concluded. The failure is not that the Note reads badly; it is that it is
not mine, and nothing in the file marks which sentences were.

**Times seen:** noticed once in use on 2026-08-23; on review, present in **6 of 8** Notes.

**Not yet established:** whether this comes from the Organize instructions, the model in use
(`deepseek/deepseek-v4-flash`), the absence of a length or scope constraint, or the second
unconditional Organize recorded in finding 01. Deliberately not diagnosed here.

**How to observe the rest, next time:** capture a deliberately short, plain Dump — one sentence,
no question in it — and compare the saved Note against it line by line, marking every sentence
that was not derivable from the Dump alone.

**Established since (2026-08-24, from a diagnosing-bugs loop):** the cause is the Organize
instructions — specifically, the absence of a faithfulness constraint. `buildOrganizePrompt`
(`src/lib/llm.ts`) asked for `body: the cleaned, organized content in markdown` but never told
the model the Organize contract CONTEXT.md already states ("Every part of this is derived from
the Dump alone except the related links"). Given a short problem-Dump, the model "helpfully"
solved it.

A tight loop drove the real seam (`createOrganizer` → `buildOrganizePrompt` → `chat`) with the
exact macbook Dump above and a lexical-faithfulness detector (a sentence is invented when most
of its content words do not appear in the Dump). Before the fix it went red **5/5** — every run
invented "Reset SMC and NVRAM", "Check System Information for battery status", "running Apple
Diagnostics", exactly the finding's examples; expansion ×3.7–×7.2. The double-organize (finding
01) was ruled out: the loop calls `organize` once and still invented, so the first call alone is
the cause.

**Resolved since (2026-08-24):** `buildOrganizePrompt` now carries an explicit faithfulness
clause — derive only from the Dump, do not add troubleshooting/causes/recommendations/steps not
present, do not invent sections, a short Dump yields a short Note. The loop went **0/5** green
(expansion ×1.0–×2.0; run 1's body restated the Dump's three clauses as bullets with nothing
added). Locked down two ways: a deterministic guard (`tests/llm-provider.test.ts`) asserts the
prompt carries the clause, and an env-gated real-model symptom test
(`tests/organize-faithfulness-smoke.test.ts`) asserts no invention against the live model. The
model and the missing length constraint were secondary; the faithfulness clause subsumes them for
this symptom.

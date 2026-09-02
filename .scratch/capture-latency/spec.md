Status: ready-for-agent

# Capture Latency

## Problem Statement

Capturing a thought takes long enough that the app stops being a place to put thoughts.
Measured on the phone during dogfooding on 2026-09-02, against the durable log in
`logs/brain-dump-log-2026-09-01.jsonl.ndjson`:

- **23 seconds** from pressing Capture to seeing a preview.
- **15+ seconds** from confirming the preview to the Note being filed, with **nothing on
  screen changing at all** — no spinner, no disabled button, and a countdown edge that
  finished draining ten seconds earlier. The screen is indistinguishable from a hang.
- **44 seconds** for an Append, which re-organizes the target Note wholesale.

Nielsen's response-time limits put **10 seconds** as the boundary of held attention: past it
users disengage, and a progress indicator becomes mandatory rather than polite. Every leg is
past it. For an app whose entire premise is catching a thought before it evaporates, the
capture path is the one place this cannot be true.

Two independent causes, and fixing either alone leaves the app slow.

**Every chat call is reasoning, and nobody chose that.** `chat()` (`src/lib/llm.ts:277`) sends
no reasoning field, so the provider default applies. From OpenRouter's live model metadata:
`deepseek/deepseek-v4-flash` carries `default_effort: "high"`, and `z-ai/glm-5.3-flash` — the
model in Settings on 2026-09-01 — carries `mandatory: true, default_effort: "max"`, so
reasoning cannot be turned off on it at all. The first Organize after that switch took
**34.7s**. Published work on extraction and classification puts reasoning's benefit at about
**+4.9% accuracy for ~6.7x output tokens**, and recommends standard models for exactly the
task shapes here: Organize is extraction, Match is binary classification, Related is
multi-label selection. The Organize prompt is restrictive — *derive only from the Dump,
invent nothing* — which is the opposite of what a thinking budget helps with.

**The path serialises work the user cannot see.** `startCapture` awaits Organize *then* Match
before rendering anything, though Match only decides new-vs-append and changes nothing on the
preview. `finalizeCapture` runs the whole Related pass — a full vault read, two embedding
calls, a judge chat — *before* `writeNote`, so the file the user is waiting for is the last
thing that happens. This cause is structural: it survives any model change, and at 5s a call
it still stacks into double digits.

There is a correctness problem tangled into the second cause. The preview renders a Related
section that always reads `Links are found when the Note is saved`, and then the app writes
links into the Note that the user never saw. `foundNewNote` guarantees the opposite for every
other field — *"the Note the user approved is the Note that gets saved"* — and Related is the
one thing leaking out of that guarantee.

And one loss point predates all of this: `recoverPending` (`src/lib/operations.ts:1533`)
organizes and writes without ever computing Related, so **every offline Capture lands with an
empty `## Related` by construction**. That is finding 08's first loss point, still open.

## Solution

**Related is computed for the preview, not during the save.** The preview becomes the whole
Note — links included — and the save is reduced to writing the file.

```
T+0    Capture pressed
T+4    preview renders; readable and editable
       related: "Links are found when the Note is saved."
T+7    Match resolves (the Append/Save buttons settle)
       related: resolving
T+12   links land → countdown edge starts draining, autosave armed
T+17   timer fires → file written
       countdown edge refills and turns to dry ink
       the Context field is replaced: the Dump is frozen; a further capture Appends here
```

Four changes carry it, and one rule places all of them: **work runs where the wait is free,
and never where the user is waiting on a result they cannot see** (ADR-0010).

- **Reasoning is disabled explicitly** on all three chat calls, and the model is pinned to
  `deepseek/deepseek-v4-flash-0731` — the current snapshot of the same family, scoring 51.8
  on OpenRouter's intelligence index against 42.1 for the pinned 0423, at the same price.
- **The preview renders as soon as Organize returns.** Match resolves behind it.
- **Related runs during the preview**, with a 5s deadline. Past the deadline the Note is
  filed without links.
- **The autosave timer is armed only when everything the user is meant to see is on screen**,
  so the countdown means one thing: the time to decide on Context or Hold.

Recovery computes Related too, because recovery is the other place nobody is waiting.

And the measurement comes first: the diagnostics log currently records that a request
*started* and never how long it took, so every number above is an inference from timestamp
gaps. Ticket 01 makes the before/after real.

## User Stories

1. As the user, I want to see the organized Note within a few seconds of capturing, so that
   the app keeps up with the thought instead of outlasting it.
2. As the user, I want the Note I approve to be the Note that gets saved, links included, so
   that nothing is written into my vault that I never saw.
3. As the user, I want the Related links to appear in the preview while I am reading it, so
   that the waiting happens where I am already looking.
4. As the user, I want the app to tell me it is working, so that a slow save is never
   indistinguishable from a broken one.
5. As the user, I want a slow or failed Related pass to cost me links and never the Note, so
   that a network problem cannot strand a thought.
6. As the user, I want the countdown to mean "you have five seconds to add Context or press
   Hold", so that the clock is not running while the app still has work to do.
7. As the user, I want an Append suggestion to still be offered even though the preview
   appears sooner, so that speed does not cost me duplicate Notes.
8. As the user, I want my offline captures to get Related links like every other Note, so
   that capturing without signal is not a second-class path.
9. As the user, I want to see the Note settle into the vault before the sheet goes away, so
   that filing has a visible end rather than a disappearance.
10. As the user, I want to keep choosing my own model in Settings, so that a better or
    cheaper option is a text edit rather than a release.
11. As the maintainer, I want every LLM call's duration and token usage in the diagnostics
    log, so that the next latency question is answered with measurements instead of
    timestamp arithmetic.
12. As the maintainer, I want reasoning explicitly off rather than left to a provider
    default, so that a model swap cannot silently reintroduce a thinking budget.
13. As the maintainer, I want the model pinned to a dated snapshot, so that the Organize
    prompt is never quietly re-tuned by a model that changed underneath it.

## Implementation Decisions

- **Vocabulary is unchanged.** No new `CONTEXT.md` term. During the wait the Note does not
  exist yet, which is already **Pending**; an interruption already makes it **Stranded**. The
  **Related** entry — *"recomputed on every Organize"* — becomes more accurate, not less:
  today links are recomputed on every save.

- **Measure before changing.** Ticket 01 ships and runs first. The 23s / 15s / 44s figures
  are inferred from gaps between `op: 'http'` log lines, which record only that a request
  began. Every later ticket records a before/after from the same instrumentation.

- **`reasoning: { enabled: false }` on all three chat calls**, verified by observing
  `usage.reasoning_tokens === 0` rather than assumed. `deepseek-v4-flash-0731` reports
  `mandatory: false` but lists only `[max, high, low]` in `supported_efforts`, so "off" must
  be confirmed empirically; if it is not honoured, the floor is `effort: "low"`.

- **A pinned snapshot, not the `~latest` alias.** OpenRouter offers
  `~deepseek/deepseek-v4-flash-latest`, and it resolves to 0731 today, so it buys nothing
  now. It is rejected on the failure mode: a model changing underneath a hand-tuned
  faithfulness prompt produces no error and no log line, only Notes that gradually get worse.

- **Cost is not a decision input.** Reasoning-on at 6.7x completion tokens on the cheap model
  costs about the same as a stronger model with reasoning off, and both are fractions of a
  cent per month at this volume. Latency and output quality decide.

- **Related's placement reverses an explicit v1 decision** and needs ADR-0010, not a code
  comment. The related-notes spec chose save-time placement to keep the capture path instant;
  in practice it moved the wait to the moment with the least feedback and broke the
  approve-what-you-save guarantee.

- **`foundNewNote` reuses the preview's links under the same condition it already reuses the
  preview Organize** — no Context added. Adding Context re-organizes the Note, so its links
  are recomputed. One `if (context)` shape governs both.

- **The Append path is unchanged and stays slow.** It re-organizes the target wholesale from
  the merged Dump, so a preview's links describe a different Note. Its 44s is out of scope
  here beyond what ticket 02 buys it.

- **A 5s deadline on the preview's Related pass.** Past it the timer is armed regardless.
  This extends `related.ts`'s existing rule — *"losing the links is a far better outcome than
  losing the Note"* — to a judge that is slow rather than broken.

- **Related runs speculatively, for previews that are never saved.** Accepted: deferring it
  until the save is certain puts it back on the save path.

- **The timer must not be armed when the preview renders.** Match has been logged at 4.9s
  against a 5s timer; arming at render lets an autosave fire before the Append suggestion
  arrives and found a duplicate Note.

- **The sheet becomes the saved Note rather than closing.** The Context field is replaced,
  not disabled — `addContext` throws on a frozen Dump, and a disabled field invites a click
  that means nothing. The countdown edge's `.committed` cross-fade already exists in
  `app.css` and has never played; it becomes the save's completion signal.

- **Streaming is for liveness only.** `stream: true` with a token callback so the preview
  wait is visibly alive. No incremental JSON parsing — the reply is consumed whole, as now.
  Gated on ticket 01's measurement (see ticket 07).

## Testing Decisions

- **Seam A — the operation layer — stays the primary seam**, as in every prior thread.
  Deterministic fakes for `Organizer`, `Matcher`, `Embedder`, `Relater`; in-memory PouchDB.
  Assert on what the user could observe: the documents actually written, and their content.

- **Never assert on prompt text or request bodies**, with one deliberate exception: the
  reasoning field is a *contract with the provider*, not a prompt, and `llm-provider.test.ts`
  already pins request shape. Ticket 02 extends it there.

- **Ordering is the thing to pin, and fakes must be able to express delay.** The properties
  worth tests: the preview resolves before the Matcher does; the autosave timer is not armed
  until both Match and Related have settled or the deadline has passed; a Related fake that
  never resolves still results in a filed Note; `foundNewNote` makes no Relater call when no
  Context was added; it makes one when Context was added.

- **The duplicate-Note regression is the highest-value assertion in ticket 03:** with a
  Matcher that resolves after the timer would otherwise have fired, the capture must still
  offer the Append rather than founding a second Note.

- **Recovery gets the same Related assertions the founding path has** (ticket 05), including
  the dead-link guarantee: every emitted link corresponds to a document in the fake vault.

- **The replay harness is the acceptance loop for link quality**, not unit tests —
  `scripts/debug-related-replay.mjs` (untracked, `[DEBUG-replay]` marked), as used for
  finding 08's tickets 03/04.

- **The real acceptance is a dogfooding session on the phone**, with ticket 01's durations
  from the durable log recorded before and after. Numbers, not impressions.

## Out of Scope

- **The Append path's 44 seconds** beyond what reasoning-off buys it. It re-organizes a whole
  Note from an accumulated Dump; making that fast is a different problem.
- **Incremental JSON parsing of a streamed reply.** Real complexity for a preview about to be
  read whole.
- **Backgrounding the Note write itself**, and any design where the file is written twice or
  a card reaches the grid before its file exists. Rejected in ADR-0010 on Obsidian sync risk.
- **Re-computing Related for Notes already filed with an empty section.** The user can
  Re-organize a Note; no code needed.
- **Embedder model, similarity floor, cap, `embeddableText`** — settled by finding 08's
  bake-off, nothing to gain.
- **Prompt-quality work on Organize.** If reasoning-off degrades output, that is a finding to
  record and a prompt to revisit, not a reason to keep a thinking budget.
- **The `_index.md` boilerplate wasting shortlist slots** (finding 08 side-note).

## Further Notes

- **The answer to the question that started this** — "is it because we use a reasoning
  model?" — is yes, that is the largest single factor, and on `glm-5.3-flash` it is not a
  parameter but a property of the model. It is not the only factor: the sequencing survives
  any model change.

- **Two corrections to earlier assumptions**, recorded so they are not re-litigated. A
  double-tap on Save now is already safe: `autosave.ts:29`'s `saving` flag refuses re-entry,
  so the missing loading UI is a feedback bug and not a data-corruption one (dogfooding
  finding 09). And embeddings are not a bottleneck: the cache logged 53/54 and 57/57 hits,
  costing about a second.

- **The countdown edge's wet→dry cross-fade has never played.** `app.css:872` describes it as
  *"the one moment worth animating — molten to permanent — and it happens exactly where the
  meaning is"*, but `.committed` is only ever applied to the Note sheet as a static state;
  the capture sheet always closed just before the Note reached the Vault. Ticket 06 is the
  first time that animation runs.

- **Domain vocabulary:** this spec uses the terms defined in `CONTEXT.md` (Dump, Note,
  Context, Organize, Related, Capture, Pending, Stranded, Append, Sheet, Vault).

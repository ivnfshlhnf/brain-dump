# The preview is the whole Note; work runs where the wait is free

Related links are computed for the capture preview instead of during the save. The Note the
user approves is the Note that gets written — links included — and the save is reduced to
writing the file. Every other call on the capture path is placed by one rule: **work runs
where the wait is free, and never where the user is waiting on a result they cannot see.**
Decided 2026-09-02 after dogfooding measured 23s to a preview, 15s+ to a saved Note, and 44s
for a re-organize.

## Context

The capture path had grown three waits, and only one of them was ever visible:

- **23s to the preview.** `startCapture` awaits Organize, then Match, before rendering
  anything. Logged at 15.2s + 4.9s.
- **15s+ from confirming to filed.** `finalizeCapture` runs Related — a whole-vault read, two
  embedding calls, and a judge chat — *before* `writeNote`. The sheet stayed open for all of
  it with no spinner, no disabled button, and a countdown edge that had already drained to
  nothing at the 5s mark. The screen was indistinguishable from a hang.
- **44s for an Append**, which re-organizes the target Note wholesale.

Two independent causes, and it matters that they are independent, because fixing either alone
leaves the app slow.

**Every chat call was reasoning, and nobody had chosen that.** `chat()` sends no reasoning
field, so each model's default applies. OpenRouter's metadata: `deepseek/deepseek-v4-flash`
carries `default_effort: "high"`, and `z-ai/glm-5.3-flash` — the model in Settings on
2026-09-01 — carries `mandatory: true, default_effort: "max"`, meaning reasoning cannot be
switched off on it at all. The first Organize after that switch took 34.7s. Published
benchmarks on extraction and classification put reasoning's benefit at roughly +4.9% accuracy
for ~6.7x output tokens; Organize, Match, and Related are extraction, classification, and
multi-label selection respectively. The Organize prompt is a *restrictive* one — derive only
from the Dump, invent nothing — which is the opposite of what a thinking budget helps with.

**The path serialised work the user could not see.** Match blocks the preview even though it
only decides new-vs-append and changes nothing the preview renders. Related blocks the file
write, which is the one thing the user is actually waiting for. This cause is structural: it
survives any model change, and at 5s per call it still stacks into double-digit waits.

Placing Related at save was a deliberate v1 decision. The related-notes spec records it:
*"Computed at final save, not at capture… The capture preview deliberately shows no related
links and makes no embedding call"*, justified by keeping the capture path instant. In
practice that reasoning inverted. Nothing was kept instant — the wait simply moved to the
moment with the least feedback — and it left the preview showing
`Links are found when the Note is saved` while the app wrote links into the Note that the
user never saw or approved. `foundNewNote` already guarantees the opposite for the Organize:
*"the Note the user approved is the Note that gets saved."* Related was the one field leaking
out of that guarantee.

## Considered options

**1. Change the model only.** Pin a snapshot that permits `reasoning: { enabled: false }` and
leave the structure alone. Rejected as insufficient, not wrong: it is real and it ships (see
Consequences), but three sequential calls at 4s each is still 12s, and the save would still
be a dead screen.

**2. Write the Note immediately, then add Related in a second write.** Fastest route back to
the grid. Rejected: two revisions of the same file seconds apart, replicated into an Obsidian
vault that has already produced a data-loss bug on a single write. It also invents a state
the domain language has no word for — a Note that exists and is knowably incomplete — which
would have forced a `CONTEXT.md` entry to describe an implementation detail.

**3. Close the sheet on save and let Related resolve behind the user.** Same second-write
problem, plus the grid would carry a card for a file that does not exist yet.

**4. Leave Related at save and add a loading indicator.** Honest about the wait but does not
remove it, and it spends 5–20s of the user's attention on links that appear roughly at the
moment the sheet closes — a progress indicator for a result the user never reads.

**5. Compute Related for the preview.** Chosen. The user is already reading the preview, so
the wait costs nothing; the preview becomes the entire Note; the save becomes a file write;
and the countdown timer regains a single honest meaning — the time to decide on Context or
Hold, rather than a clock running while the app still has work to do.

## Consequences

- **Related moves into the preview phase.** After Organize returns, the preview renders and
  the Related section shows a resolving state; the links land in it before the autosave timer
  is armed. `foundNewNote` reuses `session.preview.related` under exactly the condition it
  already reuses the preview Organize — no Context added — so one `if (context)` shape now
  governs both.

- **Related is recomputed when the Note changes.** Adding Context re-organizes the Note, so
  the preview's links no longer describe it and are recomputed at save. The Append path
  re-organizes the target wholesale and computes Related there as before; a preview's links
  are meaningless for a Note built from a different Dump. Both paths keep their save-time
  wait. This closes the gap between the code and the `CONTEXT.md` definition of Related,
  which already said links are *"recomputed on every Organize"* — previously they were
  recomputed on every save.

- **Related is given a 5s deadline, and a miss is not a failure.** Past it the timer is armed
  regardless and the Note is filed without links. This extends a rule `related.ts` already
  states — *"losing the links is a far better outcome than losing the Note"* — to the case
  where the judge is merely slow rather than broken. The alternative, a timer that waits
  indefinitely, would make "put it down and it files itself" conditional on a network call.

- **Related now runs for previews that are never saved.** A Held-then-closed capture pays for
  a whole-vault ranking and a judge call that produce nothing. Accepted: it is a background
  call at personal-vault scale, and deferring it until the app is confident the Note will be
  saved would put it back on the save path, defeating the change.

- **Recovery computes Related too.** `recoverPending` organized and wrote without ever
  calling it, so every offline Capture — the arc this app exists for — landed with an empty
  `## Related` by construction (finding 08's first loss point). Recovery is the other place
  the wait is free, because nobody is watching it. Leaving it out would have made the rule
  hold on the path with a user and fail on the path without one.

- **The capture sheet becomes the saved Note rather than closing.** With nothing left to wait
  for, the sheet stops being a screen the user waits on and starts being the receipt: the
  Context field is replaced by a line saying the Dump is frozen and a further capture will
  Append, and the user closes the sheet themselves. This makes the wet→dry countdown-edge
  cross-fade reachable for the first time — `app.css` describes it as *"the one moment worth
  animating — molten to permanent"*, and it has never once played, because the sheet always
  closed just before the Note reached the Vault.

- **Match no longer blocks the preview**, and the autosave timer is armed only once
  everything the user is meant to see is on screen. The timer must not be armed at render:
  Match has been logged at 4.9s against a 5s timer, so an autosave could fire before the
  Append suggestion arrived and found a duplicate Note — the exact failure Match exists to
  prevent.

- **The model is pinned to a snapshot, not to a floating alias.** OpenRouter offers
  `~deepseek/deepseek-v4-flash-latest`; it is not used. The Organize prompt is hand-tuned for
  faithfulness, and a model changing underneath it fails silently — no error, no log line,
  only Notes that slowly get worse. Taking a newer snapshot is a Settings edit.

- **Reasoning is switched off explicitly on all three calls** rather than left to the
  provider's default, and the diagnostics log records `usage` so that "off" is observed
  rather than assumed. Where a model refuses to disable it, the floor is the lowest supported
  effort.

- **`CONTEXT.md` is unchanged.** No new term was needed: during the wait the Note does not
  exist yet, which is already **Pending**, and an interruption already makes it **Stranded**.
  That the design needed no new vocabulary is the evidence it fits the existing model.

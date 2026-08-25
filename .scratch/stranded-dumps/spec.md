# Stranded Dumps

The record of what was decided in the `/grill-with-docs` session of 2026-08-24 — 16 questions
over 3 rounds. Each requirement below is the user's answer, written down as it was settled and
before any of it was built. It is the yardstick the implementation is reviewed against, so it
deliberately does not describe the implementation.

**Originating observation:** `.scratch/dogfooding/findings.md`, finding 02. Four Dumps reached
the Vault and never became Notes; nothing in the app or the Vault said so. The established cause
is a durability gap: the Dump file is the only persisted state, so "this Dump still needs
Organizing" is never recorded and an interruption between Dump-write and Note-write strands the
thought silently, unrecoverable on restart.

## The mechanism

1. **One store, not two** (Q1). Widen the existing offline outbox into the record of every Dump
   not yet Organized. A Dump enrols the moment it is durably written — online or offline — and
   leaves only when its Note exists. Do not add a second "pending Organize" store alongside the
   outbox. Reuse the existing drain loop, `online` listener, retry timer and banner.

2. **Recovery is headless** (Q2). On restart an unresolved Dump is re-Organized through the drain
   path, founding a new Note. The capture session (preview, match, Context state) is **not**
   persisted and the review screen is **not** restored. Accepted cost: one redundant LLM call, and
   the recovered Note may differ from the preview the user saw.

3. **Two detectors, different triggers** (Q3, Q14). The store is the automatic fast path, run on
   every start. Vault reconciliation — list the Dumps, list the Notes' `source:` / `_Source:`
   references, diff — is a **separate, explicit, manual action** in Config ("Find stranded
   Dumps"). It must never run automatically on start: its first run would spend LLM calls
   Organizing four Dumps from August 23–24 that the user may have abandoned, two of them
   duplicates. It reports what it found and offers to Organize, per Dump and all; it does not fix
   silently.

4. **Feedback is persisted, and the draft is cleared at Dump-write** (Q4). In-progress feedback is
   driven from the persisted record, not an in-memory flag, so a reopened app can still show it.
   The draft is cleared the instant the Dump is durably written — the Dump is safe at that point,
   and text left in the box is what invited the re-presses. Fold the count into the existing queue
   banner rather than adding a second status surface.

5. **No duplicate detection** (Q5). Do not refuse or warn on a capture whose content matches a
   recent Dump. The duplicates were a symptom of missing feedback; requirement 4 removes the cause.

6. **Recovery is automatic and announced** (Q7). It does not ask permission. The banner says what
   it is doing.

7. **A recovered Dump founds a new Note** (Q8), even if an Append was being suggested when the app
   died. Accepted and to be stated in a code comment. Do not re-run the match, which would
   auto-Append without the one-tap confirm the spec requires.

8. **Check before Organizing** (Q9). For each Pending Dump on start, first look for a Note whose
   `source:` references it; if one exists, dequeue and skip. This closes the window between
   `writeNote` and the dequeue — the Note filename is `date-slug(title)`, so a second Organize can
   retitle and write a *second file* rather than overwriting — and stops a Dump Organized on one
   device being Organized again on another. Do **not** make the Note path id-derived, and do not
   accept the duplicates.

9. **Bounded retry** (Q10). Record attempts and the last error. Back off 60s → 2m → 5m → 15m.
   After ~5 failures stop auto-retrying and surface the Dump as **Stranded** with its error and a
   manual Retry.

## Vocabulary (Q6)

Two terms in `CONTEXT.md`, written immediately (glossary, not decision):

- **Pending** — a Dump captured but whose Note does not exist yet.
- **Stranded** — a Pending Dump the app has stopped working on, which is a claim it broke a
  promise and must always be surfaced.

One term would not do: "pending for a long time" means something categorically different from
"pending".

## Storage (Q11)

- The record becomes an envelope: `{ dump, enrolledAt, attempts, lastError?, reason }` where
  `reason` is `'offline' | 'in-flight' | 'failed'`.
- `idb.ts` `VERSION` → 3, wrapping any bare v2 Dumps in `onupgradeneeded`. A silent data loss here
  is the one bug this feature exists to prevent.
- Rename the module, the type and the messages to the Pending vocabulary. Keep the IndexedDB
  **store key** as `'outbox'` so no data moves.

## Surfaces

- **Banner** (Q12) — four distinct states, kept distinct: in-flight (*"Organizing your Dump…"*),
  offline (*"…will be Organized when you're back online."*), recovered on start (*"Organizing 1
  Dump left from your last session."*), and Stranded (*"1 Dump couldn't be Organized: {error}"*
  plus Retry). Do not collapse the first three into a generic count — that reintroduces the exact
  ambiguity that caused the finding. Stranded wins when states mix. `aria-live="polite"`.
- **Config panel** (Q13) — a list of the Stranded Dumps: each one's first line, capture time and
  error, with per-Dump Retry and a link to open the Dump in Obsidian. The banner still carries the
  count and a Retry-all, so the common case needs no navigation. A count without the text is a
  notification you cannot act on.

## Verification (Q15)

TDD order, both halves:

- A real **red→green**: run the new capture path against the pre-fix code and watch the record be
  absent.
- **Operation-layer integration tests**: the record exists after an interrupted `captureOrQueue`;
  a start-time drain turns it into a Note; the `source:` pre-check skips an already-Organized
  Dump; attempts increment and stop at the cap; a bare-Dump v2 entry survives the v3 migration.
- Specifically requested: **a test that kills the flow between `writeNote` and the dequeue** — the
  duplicate-Note window, and the only failure mode here that produces visible garbage in the Vault
  rather than silence.

## Documentation (Q16)

One ADR, on one decision only: **Pending state is device-local, and the Vault is the cross-device
reconciler.** Written after the code lands. The banner copy, the retry cap and the record shape
are cheaply reversible and get no ADR.

## Consequences accepted

- Pending state is per-device. A Dump stranded on the phone is invisible to the laptop's automatic
  recovery; reconciliation is the cross-device answer.
- Window-B recovery costs one redundant LLM call and may produce a Note that differs from the
  preview that flashed by.

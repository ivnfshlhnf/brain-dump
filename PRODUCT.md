# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One person: the developer who built it, using it on their own phone and laptop. There is no
second audience, no team, no customer, and no plan for one.

The situation is specific and it is the whole product: a thought arrives at a moment when
capturing it is inconvenient — walking, mid-conversation, half-awake, in the middle of other
work. The job is to get the thought out of their head and into the knowledge base they
already keep, before the thought decays, and without making them decide where it belongs.

A second, much rarer situation: months later, they want to know what they once thought about
something, and they do not remember which Note it is in or what they called it.

## Product Purpose

Brain-dump splits capture from organizing. Capture is instant and lossless — the raw text is
written to the user's Vault before anything else happens, so a failure anywhere downstream
can never lose the thought. Organizing is the app's job: a cloud LLM turns the raw text into
a titled, tagged, summarized Note, links it to related documents already in the Vault, and
writes it into the Vault as a plain Markdown file.

Success is that the user stops losing thoughts, and that months later a question in plain
language returns a synthesized answer citing their own Notes — rather than a list of files
they still have to read.

Failure is any friction at the moment of capture. Everything else in the product is
negotiable; that is not.

## Positioning

The Notes land in the user's **real** Obsidian Vault, as ordinary Markdown files, synced by
the tool they already use. Not an export. Not an integration. Not a separate pile that they
must later reconcile.

This has a consequence a neighbouring product cannot copy without making the same choice:
because the Notes are in the real Vault, retrieval draws on the user's *entire* knowledge
base — years of personal notes the app had no hand in creating — and new Notes link into
that existing body of work rather than into a walled garden of their own.

The app writes by speaking LiveSync's internal CouchDB document format directly, for which no
official external-write API exists. That is a real bet, documented in ADR-0001, and it is the
mechanism the positioning rests on.

## Operating Context

- The user's Obsidian Vault, synced across devices by Self-hosted LiveSync backed by CouchDB.
  The Vault must be unencrypted; LiveSync's end-to-end encryption is incompatible with
  external writes.
- Obsidian itself is where Notes are read, browsed, edited by hand, and where the reverse
  side of a link is seen. The app never tries to be a reader.
- An OpenAI-compatible LLM provider, supplying both a chat model and an embedding model.
  Cloud by default; a local Ollama endpoint works.
- Capture happens on a phone as often as at a desk, frequently on a poor connection or none.
- The app is used every day, in short bursts of seconds. It is not a place anyone spends time.

## Capabilities and Constraints

- **Capture → Organize → Note.** Raw text is written first, then organized. A brief review
  follows where the user can add Context; the Note is written five seconds after they stop
  typing, or when they close the tab.
- **New or append.** Each capture either founds a new Note or appends to an existing one; the
  app suggests which and the user can override.
- **Related links** are computed at save by ranking the whole Vault with embeddings and
  having the model judge the shortlist. Links are outbound only — the app never edits a Note
  the user did not just create.
- **Ask** answers a natural-language question over the whole Vault and cites the Notes it
  used.
- **Every capture is Pending** until its Note exists — recorded durably at capture, so an
  offline capture, a failed one, and one interrupted mid-Organize all get Organized later
  without the user filing anything. A Dump the app gives up on is reported as Stranded, never
  dropped silently.
- **Writes are confined to two Managed folders.** Everything else in the Vault is readable and
  never written — a hard constraint, ADR-0002.
- **Text only.** Voice capture is deferred; the domain model already accounts for it.
- **Single user, no accounts, no server of its own.** Credentials live in IndexedDB in
  plaintext, an accepted trade for a personal app on a device the user controls.
- **Offline-capable PWA.** No runtime dependency on any CDN; assets including fonts are
  self-hosted and precached, because the offline path is the one that matters most.
- **Vocabulary is load-bearing and defined elsewhere.** Dump, Note, Context, Organize,
  Capture, Append, Related, Retrieve, Modality, Vault, Managed folder are defined in
  `CONTEXT.md`, which is the single authority for them. Use those words; do not introduce
  synonyms. This file must not redefine them.

## Evidence on Hand

- A real Vault in daily use, with real Notes produced by the app. Screenshots of the running
  app can be produced with `node scripts/shot.mjs`.
- A structured diagnostic event log (`logs/brain-dump.jsonl`) recording real runs.
- A dogfooding findings list at `.scratch/dogfooding/findings.md`, currently one entry.
- Specs and ADRs recording why each significant decision was made, in `.scratch/` and
  `docs/adr/`.

Absences that must not be fabricated: there are no other users, no testimonials, no
benchmarks, no pricing, no deployment, and no public presence of any kind. The product has
never been shown to anyone.

## Product Principles

1. **The thought survives, whatever else fails.** The raw Dump reaches the Vault before any
   model, network, or organizing step runs. Every failure mode downstream degrades quality,
   never data.
2. **The user never files anything.** Choosing a title, a folder, or a tag at capture time is
   the friction the product exists to remove.
3. **The Vault is the user's, not the app's.** The app writes in two folders and reads
   everywhere. It never edits what it did not create, and it never writes anything the user
   could not read without it.
4. **Plain files, no lock-in.** Every artifact is Markdown a human can read in any editor. If
   the app disappears, nothing is lost.
5. **Failures are recorded, never swallowed.** What was attempted, against which resolved
   URL, and what came back — because the alternative is a silent app and a lost thought.

## Accessibility & Inclusion

No requirement has been established by the user, since there is exactly one. The current
baseline, which future work should not regress: keyboard-navigable with visible focus,
`prefers-reduced-motion` respected for any motion, and both light and dark colour schemes
following the system setting.

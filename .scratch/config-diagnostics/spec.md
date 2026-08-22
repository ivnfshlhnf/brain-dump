Status: ready-for-agent

# Configuration diagnostics — say what is wrong, before a thought is at stake

## Problem Statement

Every failure this app has produced in real use has been a **configuration** failure, and
every one of them was discovered the same way: by capturing a thought, watching it fail, and
reading a browser stack trace to find out why.

The first dogfooding session is the whole problem in one story. The Config screen's cloud
fields showed greyed placeholder text — `https://openrouter.ai/api/v1`, a model name, an
embedder name — that read exactly like pre-filled defaults but were not applied to anything.
The fields were empty. So the cloud base URL was the empty string, every LLM request resolved
against the app's own origin, and each one hit the Vite dev server and 404'd. The app
reported, truthfully and uselessly, `LLM request failed: 404 Not Found`. The Dump was written
to the vault correctly, the outbox held it safely and retried every sixty seconds exactly as
designed, and none of that helped: the user could not tell whether CouchDB was broken, the
API key was wrong, the model name was wrong, or the app was. The only place the actual answer
existed was a console line reading `POST http://localhost:5173/chat/completions`, buried under
several hundred lines of caught-and-handled 409s.

Three things are wrong here, and they compound:

1. **A field that looks like it has a default, but does not.** A greyed suggestion the app
   never applies is worse than an empty field, because it stops the user from noticing the
   field is empty.
2. **Errors that are true but not actionable.** "404 Not Found" is accurate and tells you
   nothing. The one detail that identifies the cause — the URL actually requested — was
   thrown away before the error was built.
3. **Discovery only at the moment of capture.** The user finds out the app is misconfigured
   by losing a capture into the outbox. That is the worst possible moment: the thought is the
   thing at stake, and on a phone there is no console to read at all.

There is a fourth, slower problem behind those. The app writes to a real vault over a network
against a cloud provider, and when something goes wrong there is no record of what it tried.
Neither the user nor an agent helping them can reconstruct a failure after the fact; the
evidence scrolls past in a console and is gone on reload.

## Solution

The app explains its own configuration failures, at two moments.

**Before anything is at stake.** The cloud fields carry real, working defaults rather than
suggestions that look like defaults — so a fresh install is already pointed at a working
provider and model, and only CouchDB and the API key need typing. Saving settings rejects a
provider URL that could never work, naming the field while it is still on screen. A **Test
connection** action checks each external dependency **independently** and reports a separate
result for each, so a failure names one field instead of sending the user back to guessing.
The two cloud checks make real requests and spend a small amount of provider credit, and the
UI says so. A further check answers whether the CouchDB account may create a database, by
creating a throwaway one and removing it again — deleting only what it created itself.

**After something goes wrong anyway.** The app keeps a structured event log of what it
attempted and what came back — and critically, for a failed cloud request, the **resolved
URL**, which is the single detail that turns a mystery 404 into an obvious misconfiguration.
The log is visible in the app for phone use, and in development it is also appended to a
newline-delimited JSON file in the project folder, so the user can `tail` it and an agent can
parse it rather than being handed a screenshot.

The log never records Dump or Note content — only paths, lengths, and outcomes — so it does
not accumulate the user's private thoughts on disk and is safe to paste into a conversation.
Credentials never reach it at all.

## User Stories

1. As the user, I want the cloud configuration fields to arrive already filled with working
   values, so that I do not have to discover what to type.
2. As the user, I want a field that displays a value to actually be using that value, so that
   I am never misled into thinking configuration is done when it is not.
3. As the user, I want to be told immediately when I save a provider URL that cannot work, so
   that I fix it while I am looking at the field rather than an hour later.
4. As the user, I want to be told *why* a value was rejected, so that I know what to change.
5. As the user, I want to check my configuration before I capture anything, so that I never
   learn it is broken by losing a thought to it.
6. As the user, I want CouchDB, the chat model, and the embedder checked separately, so that a
   failure points at one field instead of at everything.
7. As the user, I want every check to run even when an earlier one fails, so that one broken
   dependency does not hide the state of the others.
8. As the user, I want to be told that testing the connection spends provider credit, so that
   a button never quietly costs me money.
9. As the user, I want the connection test to prove my chat model returns usable structured
   output, so that a model that cannot do the job is caught before it organizes anything.
10. As the user, I want to know whether my CouchDB account may create a database, so that a
    planned feature's storage question is answered by pressing a button rather than by
    discovering it mid-implementation.
11. As the user, I want a check that tests database creation to leave nothing behind, so that
    testing my configuration does not litter my server.
12. As the user, I want a check to never delete a database it did not create, so that
    diagnosing my configuration can never destroy my data.
13. As the user, I want the connection test to fail on an embedder that returns an empty
    vector, so that a silently useless embedder is caught rather than ranking my vault at
    random.
14. As the user, I want an error message to name the address the app actually contacted, so
    that a misdirected request is obvious rather than mysterious.
15. As the user, I want a record of what the app tried, so that I can understand a failure
    after it has happened rather than only while it is happening.
16. As the user, I want to read that record inside the app, so that I can diagnose a problem
    on my phone where there is no browser console.
17. As the user, I want to copy the whole record in one action, so that I can hand it to
    someone helping me without transcribing it.
18. As the user, I want to clear the record, so that I can reproduce a problem against a clean
    slate.
19. As the user, I want my captured thoughts kept out of that record, so that diagnostics do
    not become a second copy of my private notes.
20. As the user, I want my API key and passwords kept out of that record, so that it is safe
    to share.
21. As the user, I want diagnostics to never break a capture, so that the machinery for
    explaining failures cannot itself cause one.
22. As the user, I want a failed capture to still preserve my thought, so that a
    misconfiguration costs me an explanation and not a memory.
23. As the user, I want the app to distinguish "you are offline" from "something else failed
    while you were online", so that I am not told a falsehood about my connection.
24. As the maintainer, I want the event record written to a file in the project folder during
    development, so that I can follow it with standard tools instead of scraping a console.
25. As the maintainer, I want that file in newline-delimited JSON, so that it is both readable
    by eye and parseable by a script or an agent.
26. As an agent working on this repo, I want to read a failure record directly from the
    filesystem, so that I can diagnose a problem without asking the user to paste a stack
    trace.
27. As the maintainer, I want the file log to exist only in development, so that a shipped
    build has no endpoint that writes anywhere.
28. As the maintainer, I want the log file kept out of version control, so that a record
    describing a real vault is never committed.
29. As the maintainer, I want logging to be an injected dependency with a no-op default, so
    that adding instrumentation to a code path never forces every caller and test to supply
    one.
30. As the maintainer, I want the operation layer's own instrumentation covered by tests, so
    that the events I rely on when debugging cannot silently stop being emitted.
31. As the maintainer, I want configuration validation to live where it can be tested, so
    that the rule is pinned by a test rather than by a component.
32. As the maintainer, I want the connection check driven as an operation like any other, so
    that this feature does not add a test seam of its own.

## Implementation Decisions

*(Items marked **[shipped]** are already implemented; the rest is the remaining work this
spec exists to specify.)*

- **[shipped] Real defaults, not suggestions.** The default settings carry a working
  OpenAI-compatible base URL, chat model, and embedder model — the exact combination verified
  live by the Seam C smoke test. The placeholder attributes were removed from those fields,
  because a placeholder on a field that now holds a real value is misleading twice over. The
  API key is the only cloud field with no possible default.

- **[shipped] Provider URL validation at save.** Saving configuration rejects a provider value
  that is blank, unparseable as a URL, or not `http`/`https`, and reports which. Validating at
  save is deliberate: at request time the context is a queued Dump and a stack trace, whereas
  at save time the offending field is still on screen.

- **[shipped] A logging seam, injected and optional.** A single function type is the seam; the
  operation layer and the cloud plumbing depend only on it, and it defaults to a no-op. This
  is why instrumentation could be added without touching a single existing caller or test.

- **[shipped] A bounded in-memory event buffer with an optional sink.** The buffer is capped so
  a long-lived session cannot grow it without limit. The sink is where durability comes from,
  and a throwing sink is swallowed — diagnostics must never become the cause of a failure.

- **[shipped] Failed cloud requests record the resolved URL**, in both the log event and the
  thrown error message. This is the decision that fixes the original bug class: the configured
  value and the value actually requested can differ, and only the latter identifies the fault.

- **[shipped] A development-only file sink.** A browser cannot write to the project folder, so
  the sink posts each event to a dev-server middleware that appends it to a newline-delimited
  JSON file. The middleware is registered for the dev server only, so a production build has
  no such endpoint; the log directory is ignored by version control because it describes a
  real vault.

- **[shipped] Events carry paths, lengths, and outcomes — never content, never credentials.**
  This keeps a file of the user's private thoughts from accumulating on disk and keeps the log
  safe to paste into a conversation.

- **[shipped] Three independent connection checks.** CouchDB, chat, and embedder are checked in
  one operation that always runs all three and returns a separate result for each. The chat
  check goes through the real Organize path, so it also proves the model honours the strict
  JSON mode that ADR-0003 requires of any chosen model. The embedder check fails an empty
  vector, because an empty vector makes every similarity score zero and ranks the vault at
  random — a silent failure worth catching at the Config screen. The CouchDB check asks the
  server to authenticate and answer without reading the vault, so testing the connection costs
  less than the thing it tests.

- **[shipped] Errors are reduced to their message before reaching the UI or the log**, never
  passed through as objects, since a thrown response could otherwise carry request headers —
  and therefore the API key — into both.

- **[shipped] A fourth check: may this account create a database?** CouchDB requires
  server-admin rights to create one, and the answer decides how the planned embedding cache is
  stored. Roles alone do not determine it reliably across server configurations, so the check
  asks: it creates a throwaway database and removes it again. **It only ever deletes a database
  it created itself** — if the probe name is already taken it reports that and deletes nothing,
  because a check that could destroy a real database would be far worse than an unanswered
  question. A failed cleanup still reports the success and names the leftover to remove by
  hand. The check is skipped entirely when no server-level dependency is supplied, so it costs
  existing callers nothing.

- **Move provider validation out of the view.** The validation rule currently lives in the UI
  component, which contradicts this repo's own principle that the view is a thin shell and
  behaviour lives in the operation layer. It should move beside the other configuration
  operations so it is reachable by a test.

- **Instrument the operation layer's remaining meaningful transitions** and, more importantly,
  cover the existing ones. Capture, queue-on-failure, and each drain attempt already emit
  events; nothing asserts that they do.

- **Keep the connection check an operation, not view logic.** It already is: it takes its
  dependencies and returns a result, and the view only renders it. Preserve that.

## Testing Decisions

- **What makes a good test here:** assert on what a user or an agent could observe — the
  results a connection check returns, the events an operation emits, the message an error
  carries. Never assert on the buffer's internals, the file's on-disk layout, or the wording of
  a prompt. Failures are simulated by making dependencies fail, not by reaching inside modules.

- **Seam assessment, honestly.** This feature currently sits at **two and a half** seams, and
  the spec's remaining work is partly about collapsing that:
  - The **connection check** is tested by driving it directly. This is *not* a new seam below
    Seam A: it is a new operation-layer entry point, peer to capture and retrieve, and the view
    calls it exactly as tests do. Keep it.
  - The **cloud seam's URL reporting** is tested by stubbing the network and asserting the
    logged and thrown detail. This sits at the same level as the existing provider tests, and
    is prior art rather than a new seam.
  - The **event buffer** is tested directly as a data structure. This is genuinely below Seam A.
    It is acceptable for the buffer's own contract (ordering, bounding, sink behaviour, a
    throwing sink) because that is pure and has no meaningful expression at a higher level —
    but it must not be where *instrumentation* is asserted.
  - **The gap:** no test drives the operation layer and asserts what it emitted. The capture,
    queue-on-failure, and drain events exist and are relied on for debugging, and would fail
    silently if removed. This is the main testing work remaining, and it belongs at **Seam A**,
    passing a recording log into the existing operations and asserting on the events observed —
    no new seam, no new module.

- **Validation must become testable.** While the rule lives in the view it is reachable by no
  test at all. Once moved, its cases are pinned directly: blank, missing scheme, wrong protocol,
  and valid.

- **Prior art:** the existing Seam A suites are the pattern — the outbox tests for driving
  drain against controlled failures, the operations tests for asserting on results of a capture,
  and the provider tests for stubbing the network at the cloud seam.

- **Explicitly worth pinning:** that an API key cannot appear in the formatted log; that a
  throwing sink does not break the operation being logged; that one failing check does not
  prevent the other two from running and reporting.

- **Not automated, deliberately:** the dev-server middleware that writes the file was verified
  by hand (server up, request accepted, line appended, file ignored by version control). It is
  build tooling rather than app behaviour, and testing it would mean starting a dev server in
  the suite for very little return.

## Out of Scope

- **Persisting the log across reloads.** Considered and rejected: the failure that motivated
  this reproduced every sixty seconds, so persistence would have added nothing, and storing
  events durably raises a privacy question about Dump fragments that the current in-memory
  design avoids entirely.
- **Log levels beyond informational and error.** Two levels have been sufficient; more would be
  ceremony.
- **Shipping the file log in production builds.** A browser cannot write to a filesystem, and
  giving a deployed app an endpoint that writes anywhere is not worth the diagnostic value.
- **Telemetry or any remote reporting.** This is a single-user personal app; diagnostics stay
  on the user's machine.
- **A write round-trip in the connection check.** Rejected: it would mean writing a junk file
  into the user's real vault, and the CouchDB credentials either permit reads and writes or
  neither.
- **Encrypting credentials at rest.** Unchanged from v1: configuration is stored in plaintext,
  an accepted trade-off for a single-user app on a device the user controls.
- **Retry or backoff policy changes.** The outbox's behaviour is unchanged; this feature only
  makes its failures legible.

## Further Notes

- **This work was built reactively, mid-debugging, across two commits, without a spec.** That
  is why it is being written down now: to record why each piece exists, and to name the gaps
  the hurried version left. The most important of those is that the operation layer's own
  instrumentation is currently trusted rather than tested.

- **The original failure is a good regression story to keep.** A blank provider value produced
  a *relative* URL, which the browser resolved against the app's own origin. Nothing was
  technically broken — every layer did what it was told — and the result was a 404 from the
  development server against an endpoint that has never existed. The generalisable lesson is
  that an error should report the value it acted on, not the value it was configured with.

- **The 409 responses in that session were not defects.** The metadata write is an intentional
  upsert and the chunk write is content-addressed deduplication; both catch a conflict and
  proceed. They appeared in the console because browsers log every non-2xx response regardless
  of whether the application handled it. Anyone reading a future log should know this, or they
  will chase them.

- **Domain vocabulary:** this spec uses the terms defined in `CONTEXT.md` (Dump, Note, Context,
  Organize, Append, Related, Retrieve, Capture, Modality). Diagnostic events should use the same
  vocabulary in their operation names so a log reads in the project's language.

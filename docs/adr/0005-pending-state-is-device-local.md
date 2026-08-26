# Pending state is device-local; the Vault is the cross-device reconciler

The record of which Dumps still need Organizing lives in this device's IndexedDB, even though
CouchDB is right there and syncs to every device the app runs on. Automatic recovery therefore
only ever sees Dumps captured on the device doing the recovering. A Dump stranded on the phone
is found on the laptop by asking the **Vault** — a manual reconciliation that lists the Dumps no
Note cites — and not by the Pending store.

## Context

Four Dumps reached the Vault and never became Notes without anything noticing
(`.scratch/dogfooding/findings.md`, finding 02). The cause was that "this Dump still needs
Organizing" was never persisted anywhere: the Dump file was the only durable state, so an
interruption between the Dump write and the Note write stranded the thought silently and no
restart could find it.

Fixing that means persisting the intent. Where to persist it is the decision, and CouchDB is the
obvious-looking answer — the app already writes there, it already syncs, and it would make
recovery work across devices for free.

## Considered options

- **A CouchDB document per Pending Dump.** Cross-device by construction: capture on the phone,
  recover on the laptop, no reconciliation needed. Rejected for three reasons. It is unavailable
  exactly when it is most needed — an offline capture cannot write its own "I am offline" marker,
  which is the case the outbox existed for in the first place. It would put app-internal
  bookkeeping into the user's vault database, which ADR-0002 keeps to notes only, or into a third
  app-owned database beyond ADR-0004's sibling. And two devices recovering the same record race
  into two Notes, because the Note filename is derived from the LLM's title and a second Organize
  can retitle it — so it would need a lease or a merge policy to be correct.

- **IndexedDB, plus Vault reconciliation for the cross-device case** (chosen). The Pending store
  is always writable, including offline, and it is per-device precisely because the interruptions
  it recovers from are per-device. The gap it leaves — a Dump stranded on a device you are not
  currently holding — is closed by the Vault, which is the one place that knows about every Dump
  ever captured, from any device, including ones captured before this mechanism existed.

## Consequences

- Automatic recovery is device-local. Open the laptop after the phone stranded a Dump and nothing
  happens on its own; the Dump is found by **Find stranded Dumps** in Config, which is manual.
  That is deliberate: an automatic Vault scan would, on its first run, spend LLM calls Organizing
  thoughts the user may have abandoned weeks ago.

  **Amended by ADR-0007.** Finding the stranded Dumps is now automatic: the grid reads the Vault
  in order to paint, and the same pass reports them. The objection above is preserved rather
  than overridden — it is about *Organizing* abandoned thoughts, not about finding them, and
  Organize on a stranded Dump remains an explicit user action. What changed is that the read is
  now being paid for anyway. The decision this ADR actually records — Pending state is
  device-local, the Vault is the cross-device reconciler — is unchanged.
- Clearing site data on a device discards its Pending records. The thoughts are not lost — they
  are in the Vault — but they become findable only by reconciliation.
- Recovery must be idempotent against a Note that already exists, because two devices can now
  reach the same Dump by different routes. It is: a Dump already cited by a Note (`source:`
  frontmatter, or an appended section's `_Source:` line) is dequeued without a second Organize.
  That same check closes the local window between writing a Note and dequeuing the Dump.
- The Vault, not the Pending store, is the source of truth for a Dump's *content*: recovery
  re-reads the Dump file when one exists, so Context added after the Pending record was written
  is not clobbered by the older snapshot.

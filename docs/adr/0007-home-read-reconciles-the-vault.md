# The home surface's read reconciles the Vault

The grid reads the **Managed folder** in order to paint, and the same pass reports the
**Stranded** **Dumps**. Reconciliation stops being a button in Settings and becomes a property
of opening the app. The card projection is cached in device-local IndexedDB so the grid paints
before the read completes. **Organize** on a Stranded Dump stays an explicit user action and is
never automatic.

## Context

Two facts made this decision available.

**No operation returned a list of Notes.** The only Note-listing read was the candidate
projection used for **Append** matching, which carries title, tags and summary — no Category, no
date. Everything a card needs is already in a Note's frontmatter and already parsed; only the
projection was missing.

**The reconciliation read already reads both folders in one pass**, including soft-deleted
documents. So filling the grid and finding the Stranded Dumps are not two reads that could be
shared — they are the same read.

That leaves ADR-0005, which made reconciliation manual and gave two reasons. The first was
cost: a full-Vault read that should not be spent casually. The home surface now performs that
read to paint, so the cost is already being paid and the argument no longer holds.

The second reason was that "an automatic Vault scan would, on its first run, spend LLM calls
Organizing thoughts the user may have abandoned weeks ago." **That objection is preserved, not
overridden.** Finding a Stranded Dump is not Organizing it — reconciliation only ever produced a
list, and Organize was always a separate action. Automatic finding costs one Vault read and
spends no LLM calls. The retry stays where the user presses it.

## Considered options

- **Widen the existing candidate projection and call it on every render.** The smallest change.
  Rejected: it puts a full-Vault chunk fetch on the screen the user hits every time, and the
  grid is the road to capture — the Catch control lives on it. Capture friction is the one
  unforgivable failure, so the home surface must not be the most expensive screen in the app.

- **A sibling CouchDB projection database**, mirroring the embedding cache in ADR-0004.
  Rejected as over-built: unlike embeddings, this projection is rebuildable from the Vault in a
  single pass and costs nothing to lose, so it does not earn a synced store of its own.

- **A new operation returning a card projection, plus a device-local IndexedDB cache**
  (chosen). The grid paints from cache immediately and reconciles behind it.

## Consequences

- **A Stranded Dump becomes the most visible thing in the app** rather than the least. Under the
  Field Notebook it took a button press in Settings to learn one existed.
- **ADR-0005's decision is unchanged.** Pending state stays device-local, and the Vault stays
  the cross-device reconciler. Only its *manual reconciliation* consequence changes.
- **The cache must never gate capture.** A cold, failed or empty cache shows an empty grid and a
  working Catch control — never a spinner in place of the whole screen.
- **Clearing site data discards the cache.** Nothing is lost; it is rebuilt from the Vault on the
  next open, which is exactly what a disposable projection should do.
- **Reconciliation now runs often rather than rarely**, so its existing exclusions carry more
  weight: a Dump already **Pending**, or already **Dismissed**, must never be reported as
  Stranded, or the user is told about the same thought on every open.

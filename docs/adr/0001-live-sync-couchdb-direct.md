# App writes to Obsidian via LiveSync's CouchDB, not the vault filesystem

The brain-dump app is a PWA, which is sandboxed and cannot write to the local vault
filesystem. We decided the app talks directly to the CouchDB backend that Obsidian
LiveSync uses, writing notes in LiveSync's internal document format (a metadata doc
plus content-addressed chunk docs). This syncs notes to all the user's devices through
LiveSync without a second always-on component, which is what "as simple as possible"
demanded.

## Considered options

- **Companion daemon writing vault files** — E2EE-safe and decoupled from LiveSync
  internals, but a second service to host and keep reachable from a phone. Rejected for
  simplicity.
- **Filesystem writes from the app** — impossible from a PWA browser sandbox.

## Consequences

- The app is coupled to LiveSync's internal data structure. There is no official
  external-write API yet (GitHub issue #795 is the maintainer's acknowledgment, docs
  unpublished). A LiveSync format change could break the app.
- The app must produce chunk docs alongside each metadata doc, with chunk IDs
  (`h:` + hash) matching the plugin's configured hash algorithm.
- The synced vault **cannot use E2EE** — external writes can't perform the plugin's
  crypto. The vault must be unencrypted.
- Doc `_id` must be the lowercased vault-relative path (original case in `path`), with a
  leading `/` for underscore-leading folders (e.g. `_dumps/`).
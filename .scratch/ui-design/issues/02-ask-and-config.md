**Status:** ready-for-agent

# 02 — Ask and Config

**What to build:** Design the two screens that ticket 01 left inheriting tokens without
being designed.

**Blocked by:** 01 — the design system.

## Problem Statement

Ticket 01 designed the Capture screen and built the token system. Ask and Config picked up
the tokens — they are legible and consistent — but neither was designed. Config in
particular is still a stack of eleven bare labelled inputs in source order, which is the
shape it had when it was a scratch form, not a shape anyone chose.

## Notes

- Config's fields fall into groups that the current flat list hides: the Vault (CouchDB URL,
  database, credentials, case sensitivity), the Managed folder, the embeddings database, and
  the cloud provider. Test connection reports on three of those groups independently and has
  no visual relationship to them.
- Ask has one genuine design question ticket 01 did not touch: what the screen does while it
  reads the whole Vault, which can take seconds.
- The `set` accent is reserved for things that are in the Vault. Citations already use it.

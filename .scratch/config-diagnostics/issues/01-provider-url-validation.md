**Status:** ready-for-agent

# 01 — Move the provider-URL validation rule out of the view

**What to build:** A move of the provider-URL validation rule out of the view component and
into a configuration module, returning a structured result so its cases can be pinned. No
behaviour change; no new seam.

**Blocked by:** nothing.

## Problem Statement

The provider-URL validation rule lives inside the view component (`providerUrlError`,
`src/App.svelte:314`, a nested function called once from `saveConfig`). It is real behaviour —
it decides whether configuration is accepted — but it sits where no test can reach it, and it
contradicts this repo's own principle that the view is a thin shell over the operation layer.
It is currently trusted because it was written carefully, not because it is pinned.

It is also the only validation rule in the view, so there is no seam for the next one to land
in — which is how it ended up here in the first place.

Today the rule returns a human message, and `saveConfig` logs that message as
`detail: { problem }`. The diagnostic record therefore contains presentation text and nothing a
tool can match on, against a README that advertises `jq -c 'select(.level=="error")'` as the
way to read the log.

## Solution

Move the rule into a new `src/lib/config.ts` and have it return a **structured** problem —
a stable `code` alongside the human `message` — or nothing when the value is valid. The view
calls it and renders the message; the rule itself stops being view code and its cases become
directly testable without asserting on wording.

## User Stories

1. As the maintainer, I want the validation rule to live where a test can reach it, so that it
   is guaranteed rather than merely written carefully.
2. As the maintainer, I want each rejection case pinned separately, so that a change to one
   does not quietly weaken another.
3. As the maintainer, I want the cases pinned by a stable identifier rather than by message
   text, so that rewording a message never breaks a test and never silently passes one.
4. As the maintainer, I want the view to only render the validation result, so that the codebase
   keeps its thin-view property.
5. As the maintainer, I want the next configuration rule to have an obvious home, so that it
   does not drift back into the view.
6. As the maintainer, I want a rejection to be greppable in the diagnostics log, so that a
   configuration failure can be found by a tool and not only read by a human.
7. As the maintainer, I want no new test seam introduced, so that this work stays at the seam
   the rest of the codebase uses.

## Implementation Decisions

- **A new `src/lib/config.ts`**, named for the concern rather than the single rule, so the next
  configuration rule has a home. `settings.ts` was rejected: its own header declares it app-only
  and not exercised by the operation-layer seam, which is the property being fixed here.
  `health.ts` was considered — it is the other configuration module — and passed over in favour
  of a module that is about configuration *rules* rather than live connection checks.
- **`validateProviderUrl(url: string): ProviderUrlProblem | null`**, where `ProviderUrlProblem`
  is `{ code: 'blank' | 'not-absolute' | 'bad-scheme'; message: string }` and `null` means valid.
  Problem-or-null preserves the call site's existing `if (problem)` shape, so this stays a move
  rather than a rewrite. Renamed from `providerUrlError` because `...Error` reads as "throws"
  once it returns an object.
- **Only that one rule is exported.** No `validateSettings` aggregate: today it would be a
  one-line pass-through invented for rules that do not exist. Introduce it when there are two
  real cases to shape it.
- **The rejection event logs both `code` and `message`.** This is a deliberate departure from
  the original ticket's "no change to what is emitted": nothing is removed, a machine-readable
  field is added, and it is the same principle the instrumentation ticket applies to every other
  event — identify by operation and code, never by wording.
- **No behaviour change the user can observe.** The same values are rejected, with the same
  messages, at the same moment.

## Testing Decisions

- A new `tests/config.test.ts`, since the rule now lives in a new module. This adds no seam:
  it is a pure function tested directly, like `llm-provider.test.ts` tests its own module.
- Cases to pin, one test each: blank, unparseable/scheme-less, non-http protocol, and a valid
  value. Assert on `code` and on null-for-valid — never on message text.
- Prior art: the health suite for asserting a structured result.

## Out of Scope

- Testing the instrumentation events — that is ticket 02.
- Adding new validation rules, or validating any other configuration field.
- Any change to what is accepted or rejected.

## Agent skills

### Issue tracker

Issues and specs live as markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles, label string equal to role name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### View verification

The view has no test seam by deliberate choice, so the `scripts/shot-*.mjs` screenshots are the
only thing checking it. **Screenshot the viewport, never a single element**, whenever position or
chrome is part of what you are verifying — `page.screenshot()`, not
`page.locator('.thing').screenshot()`.

An element-scoped shot carries no information about where the element sits, and an element with
no background and no border photographs exactly like one whose background and border are correct.
Both of those shipped as bugs behind a passing element-scoped shot. Element-scoped is fine for a
pure content check and nothing else.

Run `npm run check:tokens` after touching CSS: every `var(--token)` must resolve to a token that
is actually defined, because an undefined one voids its whole declaration silently.

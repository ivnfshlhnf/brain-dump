# 10 — Promote the grid to home, delete the Field Notebook

**What to build:** The cutover. The grid stops being a fourth view and becomes the app's only
persistent surface; the three old views are deleted; Capture, Ask and Settings are reached only
as sheets. A slim masthead carries the wordmark and the settings gear.

This ticket is gated on the sheets because deleting the old views without them makes the app
unusable, and gated on 03 because deleting the old Settings removes the reconcile button — so
cutting over first would make a **Stranded** **Dump** *less* reachable than it is today, a
regression on the exact problem this redesign exists to fix.

04 is not a technical gate: the grid works colourless. But shipping the home surface without
**Category** colour leaves the direction half-landed, and it should land first.

**Blocked by:** 03, 05, 06, 07, 08, 09

**Status:** done

- [x] The grid is the only persistent surface, and sheets do not nest
- [x] The three old views are deleted and the Field Notebook implementation is gone from the app
- [x] A masthead carries the wordmark and a settings gear
- [x] Every sheet is reached from the grid and returns to it
- [x] Keyboard shortcuts reach Ask and Settings
- [x] A Stranded Dump is at least as reachable after the cutover as it was before
- [x] Dark is the default when the system expresses no preference, and light follows the system
- [x] The screenshot verification scripts cover the grid and all four sheets

## Comments

- **Only one persistent surface (criterion 1).** The `view: 'config' | 'grid'` state and its
  switch are gone; the grid `<section class="surface grid-surface">` renders unconditionally. A
  sheet is a single `sheet: 'capture' | 'note' | 'ask' | 'settings' | null` string — setting it
  swaps one `<dialog>` for another, never stacks a second. `shot-home.mjs` drives c / a / s in
  sequence and asserts `count <= 1` (no nesting) after each.

- **The old views are gone (criterion 2).** The nav tabs (grid / capture / ask / settings), the
  `enterConfig` path, and the Field Notebook's wide layout and its CSS (`.page.wide`, the dead
  `.surface > :first/last-child` centring) are deleted. `onOnline`'s old `if (view === 'grid')`
  guard collapsed to an unconditional `void enterGrid()` — the grid is always the surface
  underneath any sheet.

- **The masthead (criterion 3).** `<h1 class="wordmark">brain-dump</h1>` + a `.masthead__gear`
  button (a Feather-style gear SVG, `aria-label="settings"`) opens the Settings sheet. The nav
  CSS is gone; `.masthead__gear` is appearance-less until hover/focus. Verified by the `vision`
  subagent: wordmark + gear, no tab bar, across desktop/phone × light/dark/no-preference.

- **Every sheet from the grid (criterion 4).** Capture and Ask are grid controls
  (`.grid-controls`); Settings is the gear; the Note sheet opens from a card (`.card--door`). Each
  closes (Esc fires the native `cancel` → `on:close` → `sheet = null`, or the `.sheet__close`
  button) back to the grid. `shot-ask`/`shot-note`/`shot-settings` reach each sheet through the
  real UI, not a mock.

- **Shortcuts (criterion 5).** `c` / `a` / `s` on `<svelte:window on:keydown>` fire only when no
  sheet is open, no modifier is held (`metaKey || ctrlKey || altKey || shiftKey`), and focus is
  not in an input/textarea/contentEditable field. `a` is gated on `!vaultIsEmpty` (Ask is disabled
  when the Vault is empty). `shot-home.mjs` drives all three and asserts each opens the right
  sheet with no nesting; the gear click opens Settings by pointer.

- **Stranded reachability (criterion 6).** Stranded Dumps remain on the grid as Stranded cards
  (Retry / Dismiss), and the Settings sheet's Stranded section (ticket 08) keeps the
  find-stranded / restore / dismiss affordances. The cutover deletes only the old Settings
  *view*; the Stranded path the redesign exists to fix is untouched, so a Stranded Dump is at
  least as reachable as before.

- **Dark default (criterion 7).** `color-scheme: dark light` (dark first) in `index.html` and
  `app.css`; `:root` token defaults are the dark values; `@media (prefers-color-scheme: light)`
  is the override the system opts into; the `@supports (color: light-dark(...))` block carries the
  same intent for supporting browsers. A genuine no-preference resolves dark; system-light
  resolves light. **NB:** Chromium and Firefox (the only Playwright engines) both emulate
  `no-preference` as `light` — `matchMedia('(prefers-color-scheme: light)').matches` is true and
  `light-dark()` resolves to its light arm under no-preference — so the no-preference *render*
  is light and cannot demonstrate the dark default. `shot-home.mjs` verifies the dark-default
  *declaration* instead: the computed `color-scheme` is dark-first, and the explicit-`dark` shot
  resolves dark (proving the dark values are the `:root` default and wired). Light follows the
  system: the explicit-`light` shot resolves light.

- **Scripts cover the grid + four sheets (criterion 8).** `shot-grid.mjs` (grid), `shot-ask.mjs`
  (Ask), `shot-note.mjs` (Note), `shot-settings.mjs` (Settings), and the existing Capture coverage
  via `shot-status.mjs`'s capture-confirmed drive; `shot-home.mjs` (new) covers the home surface
  and the c/a/s shortcuts. All were re-run after the cutover (entry points moved from the deleted
  nav to the gear / `.grid-controls`).

## Verification

- `npm run typecheck` (svelte-check) — 0 errors / 0 warnings across 417 files.
- `npx vitest run` — 230 passed / 10 skipped (22 files). The 10 skips are the live-service smoke
  tests. No new tests: this ticket has no operation seam (spec: "the view has no seam,
  deliberately"), so the cutover is verified by the screenshot scripts, not component tests.
- `node scripts/shot-home.mjs` — 6 home screenshots (desktop/phone × no-preference/light/dark).
  Asserted: wordmark + gear present, Capture + Ask controls present (Ask enabled with a seeded
  card), no sheet open; c/a/s each open the right sheet with `count <= 1` (no nesting); the gear
  opens Settings; `color-scheme` is dark-first; explicit-light renders light, explicit-dark dark.
  Verified by the `vision` subagent: slim masthead (wordmark + gear), no nav tabs, grid +
  Capture/Ask, no sheet open, correct light/dark across all six.
- Re-ran `shot-grid`, `shot-ask`, `shot-note`, `shot-settings`, `shot-status` — all green after
  the cutover (sheets modal, strips on the grid, cards render).

## Code review

Two-axis review (Standards: Fowler smell baseline, no repo standards doc; Spec: this issue).
Standards — three judgement-call smells, all deliberately kept: (1) `shot-home.mjs` re-copies the
`seedStore`/`seededSettings`/`schemeOf` helpers from sibling shot scripts — kept because each shot
script is self-contained by the codebase's established convention (it mirrors App.svelte markup
and runs standalone), and extracting a shared module would diverge unless all five were refactored
(scope creep); (2) `enterGrid()` is a multi-view-era name now that there is one surface — kept
because on the `onMount` call it genuinely enters the grid, and `refreshGrid` would only move the
awkwardness to startup; (3) the `onShortcutKey` if-cascade on `c`/`a`/`s` plus the same letters in
the `title` hints — kept; a shared `SHORTCUTS` map would couple keydown logic to display strings
speculatively. Spec — one real finding, **fixed**: the shortcut guard omitted `e.shiftKey`, so
`Shift+C/A/S` still fired against the pre-approved "no modifier held" wording — added
`|| e.shiftKey`. All 8 acceptance criteria met.

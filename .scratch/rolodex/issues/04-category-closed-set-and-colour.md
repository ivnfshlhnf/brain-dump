# 04 — Category becomes a closed set, and the grid gets colour

**What to build:** **Category** stops being free text and becomes a fixed set, so that colour
can mean something. Each Category maps to a stable hue driving a card's left edge and its one
coloured chip; **Tags** stay neutral, so forty Tags never become forty hues.

This is required for colour to work at all, not for tidiness: the Vault held 12 Notes carrying
11 distinct Categories, so a hue per Category was very nearly a hue per card — colour that
looks meaningful and conveys nothing.

The members are `troubleshooting`, `productivity`, `tools`, `coffee`, `personal`, and
`uncategorized`. Hue is derived from a member's position in the declared list, stepped by the
golden angle so any number of members stay well separated:

```
hue = (index * 137.5 + 30) mod 360
```

Notes already in the Vault carry free-form Categories such as `Bug Report` and `Hardware`.
Their files are not touched.

**Blocked by:** 02

**Status:** done

- [x] Category is a closed set of five named members plus `uncategorized`
- [x] The **Organize** prompt enumerates the members and asks for exactly one
- [x] A Category outside the set, or a blank one, becomes `uncategorized` — with no error, no retry and no log noise
- [x] Each member's hue derives from its position in the declared list, never from the Category string
- [x] The list is append-only, and a comment on the type says so — sorting or inserting re-colours every Note in the Vault and raises no error
- [x] `uncategorized` receives no hue and uses the same neutral treatment as a Tag
- [x] Every member's hue differs from every other member's, and a member's hue is unchanged when another is appended
- [x] Notes already in the Vault keep their frontmatter unchanged and read as `uncategorized`
- [x] Re-organizing an existing Note assigns it a member Category
- [x] The gated provider smoke test asserts a real model returns a Category that is a member

### Close-out notes

- **The closed set lives in `src/lib/category.ts`.** `CATEGORIES` is a frozen `as const` tuple of the
  five named members with a load-bearing-order comment on the type (inserting/sorting re-colours
  every Note); `Category` is the union with `uncategorized`; `toCategory` coerces (case-insensitive,
  trims, non-member/blank → `uncategorized`, total — no throw, no log); `hueFor` returns
  `(index * 137.5 + 30) % 360` for a member, `null` for `uncategorized`.
- **Types narrowed to `Category`.** `Note`, `OrganizeOutput`, `NoteCard`, and `ParsedFrontmatter`
  all carry `category: Category`. Coercion happens at the two read seams only:
  `parseOrganizeOutput` (the model's reply) and `parseFrontmatter` (existing Notes' frontmatter).
  The write path (`organizeNote`/`refreshNoteMetadata` → `noteFrontmatter`) passes the already-coerced
  member through verbatim, so existing Notes are never rewritten (#8) — a free-form Category on disk
  reads as `uncategorized` and is corrected only on re-organize (#9).
- **The prompt enumerates the members.** `buildOrganizePrompt` lists `troubleshooting, productivity,
  tools, coffee, personal` and asks for exactly one; the faithfulness clause is untouched. A
  deterministic guard in `tests/llm-provider.test.ts` locks the enumeration + "exactly one"; the
  gated `LLM_SMOKE=1` smoke test asserts a real model returns a named member (#10).
- **Colour is position-derived, never string-derived.** `tests/category.test.ts` asserts the five
  hand-computed hues (`30, 167.5, 305, 82.5, 220`) — expected values come from the spec formula, not
  from re-running the code, so a wrong formula or a reordered list fails the test. Distinctness and
  append-stability (index-based, not length-based) are asserted; `CATEGORIES` is frozen.
- **View (no seam — screenshot-verified).** Each member Note card gets a coloured 3px left edge +
  one coloured chip via an inline `--cat-hue` custom property + a `.card--cat` class. `uncategorized`
  sets no `--cat-hue`, so it falls back to the neutral `--rule` edge + transparent chip (the Tag
  treatment). Pending/Stranded dashed cards are hue-less by construction (no `card--cat`). Per-scheme
  lightness/chroma tokens switch via `@media (prefers-color-scheme: dark)` — `light-dark()` is not
  used here because its args are `<color>` values and the hue is per-card, so the per-scheme parts
  are bare L/C numbers composed with the inline hue inside `oklch()`.
- **Verified:** `npm run typecheck` 0 errors; `npm test` 194 passed / 10 skipped (smoke); the
  narrowing's test fallout (14 fake-organizer literals + 4 assertions across 7 files) updated to
  valid members; `pending.test.ts` 37 unchanged-green. Visual verified by DOM measurement
  (computed `border-left-color` + chip `background` = the member's `oklch(L C hue)` in both light
  and dark; `uncategorized` = `--rule` edge + transparent chip) and by screenshot in light/dark ×
  desktop/phone (vision subagent: all four PASS — distinct hues, neutral uncategorized, dashed
  hue-less Pending/Stranded, legible chips). DOM measurement is authoritative over the vision
  agent's phone-column count (metrics show 2 columns at 390px, not 1).

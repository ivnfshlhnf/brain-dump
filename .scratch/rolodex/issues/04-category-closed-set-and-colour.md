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

**Status:** ready-for-agent

- [ ] Category is a closed set of five named members plus `uncategorized`
- [ ] The **Organize** prompt enumerates the members and asks for exactly one
- [ ] A Category outside the set, or a blank one, becomes `uncategorized` — with no error, no retry and no log noise
- [ ] Each member's hue derives from its position in the declared list, never from the Category string
- [ ] The list is append-only, and a comment on the type says so — sorting or inserting re-colours every Note in the Vault and raises no error
- [ ] `uncategorized` receives no hue and uses the same neutral treatment as a Tag
- [ ] Every member's hue differs from every other member's, and a member's hue is unchanged when another is appended
- [ ] Notes already in the Vault keep their frontmatter unchanged and read as `uncategorized`
- [ ] Re-organizing an existing Note assigns it a member Category
- [ ] The gated provider smoke test asserts a real model returns a Category that is a member

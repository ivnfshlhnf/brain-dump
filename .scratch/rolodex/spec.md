Status: ready-for-agent

# The Rolodex — replacing the Field Notebook

The buildable spec. It supersedes `.scratch/rolodex/prototype/spec.md` on the
`prototype/rolodex` branch, which stays at `Status: proposed` as the primary source the
mockups and the Impeccable passes produced. Where the two disagree, this one wins.

## Problem Statement

Three problems, in the order they cost the user something.

**A Stranded Dump is invisible.** The app takes a thought, fails to file it, and says nothing
unless the user opens Settings and presses a reconcile button they have no reason to press.
Four thoughts were lost exactly this way. The Vault kept them; the app never mentioned them
again. This is the app breaking its one promise — that a captured thought survives — and
breaking it silently.

**There is nowhere to see the Notes.** The app has three surfaces: capture, ask, and
settings. None of them lists a Note. The user writes into the Vault and then has to leave the
app entirely to see what they wrote. The app can file a thought and answer a question about
it, but it cannot show it.

**The Field Notebook asks the user to linger.** It is a finished, defensible design: serif on
paper, two accents, one entry at a time. But it is shaped like a book, and this user is in and
out in seconds. They want to glance, recognize, and leave.

## Solution

**The app becomes a rolodex that files itself.** The home surface is a grid of cards. Every
focused activity is a full-screen sheet that the user drops into and returns from.

**A card is a thought, not a Note.** A **Note** gets a card. A **Pending** **Dump** gets a
card. A **Stranded** Dump gets a card. A **Dismissed** Dump gets no card, because dismissing
means "stop telling me about this". So every thought the app owes the user something for is on
the home screen, and the first problem above disappears: a Stranded Dump is now the most
visible thing in the app rather than the least.

**The home read reconciles the Vault.** The same pass that fills the grid finds the Stranded
Dumps. Reconciliation stops being a button and becomes a property of opening the app.

**Colour is Category.** Each **Category** maps to a stable hue that drives a card's left edge
and its one coloured chip, so a Category is recognizable across the grid at a glance.
**Tags** stay neutral, so forty Tags never become forty hues. This requires Category to be a
fixed set, which it is not today.

## User Stories

### Seeing what I have

1. As someone who forgets things, I want to open the app and see my Notes as cards, so that I can recognize a thought without remembering what I called it.
2. As someone scanning the grid, I want each card to show its Category, title, summary and date, so that I can identify a Note without opening it.
3. As someone scanning the grid, I want each Category to have its own colour, so that I can find the kind of thing I am looking for before I read any words.
4. As someone scanning the grid, I want the same Category to always be the same colour, so that the colour is something I can learn.
5. As someone with a tag-heavy Note, I want the card to show a few Tags and a count of the rest, so that every card in the grid is the same height.
6. As someone with a tag-heavy Note, I want to open the card and see all of its Tags, so that nothing is hidden permanently.
7. As someone on a phone, I want the grid to use two columns, so that cards stay readable on a small screen.
8. As someone on a laptop, I want the grid to use more columns, so that I see more of my thinking at once.
9. As someone with an empty Vault, I want the grid to show where the first card will land rather than an error, so that a new install feels calm and not broken.
10. As someone with an empty Vault, I want the Ask control dimmed, so that I am not invited to ask questions of nothing.

### Knowing what the app owes me

11. As the owner of the Vault, I want a Pending Dump to appear as a card, so that a thought in flight is visible rather than assumed.
12. As the owner of the Vault, I want a Stranded Dump to appear as a card, so that the app cannot quietly fail to file a thought.
13. As the owner of the Vault, I want Pending and Stranded cards pinned to the top of the grid, so that they stay visible once I have more Notes than fit on a screen.
14. As someone whose Organize failed, I want the Stranded card to show my raw words, so that I can see which thought is at risk without opening anything.
15. As someone whose Organize failed, I want a retry on the Stranded card, so that I can fix it where I found it.
16. As someone whose Organize failed, I want to dismiss a Stranded Dump, so that the app stops telling me about a thought I have decided not to file.
17. As someone who has dismissed a Dump, I want it to leave the grid entirely, so that dismissing actually means what it says.
18. As someone who has dismissed a Dump, I want it still listed in Settings and restorable, so that dismissing is reversible and never destructive.
19. As someone who has dismissed a Dump, I want the Dump itself untouched in the Vault, so that the app never removes a thought I wrote.
20. As the owner of the Vault, I want the app to find Stranded Dumps every time I open it, so that I never have to know a reconcile button exists.
21. As someone whose Note was deleted by Obsidian's own sync, I want that Dump to appear as Stranded, so that a thought removed by something other than me is surfaced.

### Capturing

22. As someone with a thought right now, I want one tap to reach a full-screen field, so that nothing competes with getting the thought out.
23. As someone typing a Dump, I want nothing else on the screen, so that capture stays the fastest thing the app does.
24. As someone who just captured, I want the sheet to return me to the grid with my new card at the top, so that the receipt is the thing itself.
25. As someone reviewing a capture, I want to see the whole Note before it is filed, so that I approve the real thing and not a summary standing in for it.
26. As someone reviewing a capture, I want the countdown visible on the card's edge, so that I know how long I have to intervene.
27. As someone who wants to read before filing, I want a Hold that stops the countdown, so that the clock cannot run out while I am thinking.
28. As someone who pressed Hold, I want the countdown to stay stopped, so that a clock never restarts behind me.
29. As someone who pressed Hold, I want an explicit action to file the Note, so that I decide when it lands.
30. As someone adding **Context**, I want to expand my original words and add to them, so that the Note is organized from the full thought.
31. As someone whose Dump belongs on an existing Note, I want the app to suggest the **Append** and make it the primary action, so that I confirm rather than decide.
32. As someone offered an Append, I want starting a new Note to stay available, so that I can override a wrong suggestion.
33. As someone offered an Append, I want nothing to file until I confirm, so that a wrong Append never happens silently.
34. As someone who walked away mid-capture, I want the Dump kept and re-surfaced next time, so that leaving never loses a thought.
35. As someone capturing with no connection, I want the Dump saved and marked as waiting rather than shown an error, so that being offline is not a failure.
36. As someone who comes back online, I want the waiting Dumps organized automatically, so that I do not have to retry by hand.

### Reading a Note

37. As someone who tapped a card, I want the full Note with all its Tags, key points and body, so that the card was a door and not a dead end.
38. As someone reading a Note, I want the **Related** documents in my Vault listed with links, so that I can follow a connection into my own notes.
39. As someone reading a Note, I want a link that opens it in Obsidian, so that I can edit it where editing actually happens.
40. As someone reading a Note, I want to see it was filed and where, so that I trust the thought reached the Vault.
41. As someone reading a Note, I want my verbatim Dump available, so that I can see what I actually said.
42. As someone reading a Note whose title or Tags are wrong, I want to re-organize it, so that I can fix the metadata without editing by hand.
43. As someone re-organizing an old Note, I want it to receive a Category from the current set, so that old Notes join the colour system when I touch them.

### Asking

44. As someone who cannot remember where a thought is, I want to ask a question in plain language, so that I do not have to search by filename.
45. As someone reading an answer, I want the Notes it drew from shown as cards, so that I can check the answer against my own words.
46. As someone reading an answer, I want to tap a cited card into the full Note, so that verifying is one tap.

### Being told things

47. As someone who just captured, I want a brief confirmation that it landed, so that I can leave immediately without wondering.
48. As someone using a screen reader, I want that confirmation announced without interrupting me, so that the receipt is not only visual.
49. As someone who lost connection, I want to be told once, so that I understand why things are waiting.
50. As someone whose settings are wrong, I want to be told what was rejected, so that I can fix it.
51. As someone being told something, I want to clear the message, so that nothing holds me hostage.
52. As someone who is colour-blind, I want every state to carry a word and not only a colour, so that the app is legible without hue.

### Settings and appearance

53. As the owner of the Vault, I want Settings reached from the grid and returned to it, so that it behaves like every other sheet.
54. As the owner of the Vault, I want to check my connections and see which are reachable, so that I can diagnose a failure myself.
55. As someone in a dark room, I want dark to be the default, so that the app suits when I actually use it.
56. As someone whose system prefers light, I want the app to follow it, so that it matches everything else on my device.

## Implementation Decisions

### The home read

- **A new operation returns a Note-card projection.** The operation layer gains a `listNotes`
  operation returning, per Note, the vault-relative path, title, Category, summary, Tags and
  creation time. Every field already exists in a Note's frontmatter and is already parsed; only
  the projection is new. The existing candidate-reading operation used for Append matching is
  left alone — it is a different projection for a different job.
- **One pass serves the grid and reconciliation.** The existing reconciliation read already
  reads the **Managed folder** and the Dumps folder together, including soft-deleted documents.
  `listNotes` uses that same pass, so filling the grid and finding **Stranded** Dumps cost one
  read rather than two.
- **Reconciliation happens on the home read, not on a button.** This amends ADR-0005. That
  ADR made reconciliation manual because it costs a full-Vault read that should not be spent
  casually. The home surface now performs that read to paint, so the cost argument no longer
  holds. ADR-0005's actual decision — **Pending** state is device-local — is unchanged.
- **The projection is cached in IndexedDB, device-local.** The grid paints from cache
  immediately and reconciles behind it. This inherits ADR-0005's device-local reasoning; the
  Vault stays the source of truth and the cache is disposable.
- **The grid is the road to capture.** The Catch control lives on it, so the home read must
  never gate the capture path. A cold or failed cache shows the capture control and an empty
  grid, never a spinner in place of the whole screen.

### Category

- **Category becomes a closed set.** The domain types gain a Category union with five named
  members plus a fallback: `troubleshooting`, `productivity`, `tools`, `coffee`, `personal`,
  and `uncategorized`. The five were chosen from the Categories already present in the Vault
  (see Further Notes).
- **The Organize prompt enumerates the members.** The LLM seam lists the allowed Categories
  and instructs the model to choose exactly one.
- **Parsing is total.** A Category the model returns that is not a member — and a blank one —
  becomes `uncategorized`. `uncategorized` is an ordinary member, not an error: no retry, no
  failure, no log noise.
- **Hue is derived from position, never from the Category string.** The prototype hashed the
  string into a fixed palette; that is replaced. Each Category's hue is its index in the
  declared list, stepped by the golden angle:

  ```
  hue = (index * 137.5 + 30) mod 360      // in OKLCH, at a fixed lightness/chroma per scheme
  ```

  This gives well-separated hues for any number of Categories, removes the hand-cut palette,
  and removes any ceiling on how many Categories can exist. `uncategorized` receives no hue and
  uses the neutral chip treatment that Tags use — the absence of a Category is not a colour.
- **The Category list is append-only and its order is load-bearing.** Adding a member at the
  end is free. Inserting or sorting the list re-colours every Note in the Vault. This must be a
  comment on the type, not only a line in an ADR.
- **Existing Notes are not rewritten.** Notes already in the Vault carry free-form Category
  strings such as `Bug Report` and `Hardware`. Those files are left exactly as they are. They
  read as `uncategorized` and are corrected only when the user re-organizes that Note. A bulk
  frontmatter rewrite across the Managed folder is rejected: it is a large write against the
  user's real files for a cosmetic gain.
- **Tags carry no colour.** They stay neutral, so the visual vocabulary is capped by the
  Category set by construction.

### The view

- **One home, four sheets.** The grid is the only persistent surface. Capture, Ask, Note and
  Settings are full-screen sheets reached from it and returned to it. Sheets do not nest.
- **A card is a thought.** Notes, **Pending** Dumps and **Stranded** Dumps all get cards.
  **Dismissed** Dumps do not. Restore for a Dismissed Dump lives in the Settings sheet.
- **Pending and Stranded pin to a band at the top.** Notes sit below in reverse chronological
  order. Pinning is required by the domain: Stranded is defined as always surfaced, and
  chronological placement makes that promise false as soon as the Vault outgrows one screen.
- **Pending and Stranded cards carry no Category hue.** They are dashed and neutral, so state
  and Category never compete for the same signal even when a hue is close to a state colour.
- **`Dismissed` is a domain term only.** A sheet the user shuts is *closed*. A message the
  user waves away is *cleared*. Only a Stranded Dump is *dismissed*. This is recorded in the
  glossary so it cannot drift back.
- **Hold cancels the autosave timer; it does not pause it.** Hold is the existing cancel plus a
  UI state, and the only exit is the user explicitly filing. A resumable countdown was rejected:
  the difference between resuming at full and at remaining time is invisible on screen, and any
  resume restarts a clock the user pressed a button to stop. The autosave module needs **no new
  interface**.
- **The status line carries three kinds of message**: a brief capture confirmation, connection
  lost or restored, and a settings rejection. Queued and failed are deliberately excluded — they
  now live on their own cards, and the strip's own rule is that state belongs on the thing it is
  about. It is announced politely to assistive technology, and every message can be cleared.
- **The status line is fed by a callback on the operation layer, not an event bus.** This
  matches the existing pending-notification callback and keeps the source assertable at the
  existing test seam.
- **Two type faces carry over**: serif for the user's thought, mono for the app's scaffolding.
- **Dark leads; light is a twin that follows the system.**

### Documentation

- The Rolodex design files move from the prototype branch to the repo root and replace the
  Field Notebook's. The Field Notebook's design record is kept as a superseded document; its
  implementation is deleted.
- Three ADRs: the direction change and what restraint it traded away; the home read plus
  reconciliation-on-read plus the projection cache, with a pointer added to ADR-0005; and
  Category as a closed vocabulary with hue by index.
- The glossary changes are already made: **Category** and **Tag** are defined, **Dump** now
  states that every Dump is in exactly one of four states, and **Dismissed** states that only a
  Stranded Dump can be dismissed.

## Testing Decisions

**What makes a good test here.** Tests assert observable behaviour through the operation layer
as a black box — what ends up in the Vault, what the projection contains, what the store holds
after a restart. They do not assert on how a function is structured internally. This is the
discipline the existing suite already follows.

**Seam A — the operation layer. This is where the work is tested.** CouchDB is an in-memory
PouchDB, the Organizer and Matcher are deterministic fakes, and IndexedDB stores are the real
implementations driven against `fake-indexeddb`. Covered here:

- `listNotes` returns the projection for Notes in the Managed folder, and excludes Dumps,
  personal notes and soft-deleted Notes.
- One pass yields both the projection and the Stranded list, and the Stranded results match
  what the existing reconciliation operation returns for the same Vault.
- Dumps that are already Pending, and Dumps the user has Dismissed, are excluded from the
  Stranded results — the existing exclusion rules still hold when reconciliation is automatic.
- The projection cache survives a restart, is rebuilt from the Vault when absent, and a failed
  or empty cache never blocks the capture path.
- An Organize returning a Category outside the set yields `uncategorized`; so does a blank one.
  Parsing never throws on a Category.
- A Category's hue is stable as members are appended, and every member's hue differs from every
  other member's.
- A Note written today carries a member Category in its frontmatter; a Note already in the Vault
  with a free-form Category is read as `uncategorized` and its file is not modified.
- Re-organizing an existing Note assigns it a member Category.

Prior art: `tests/operations.test.ts` for the in-memory PouchDB setup and frontmatter
assertions; `tests/pending.test.ts` for driving a real IndexedDB store against `fake-indexeddb`
and for asserting durability across a simulated restart; `tests/related.test.ts` for asserting
a projection's contents.

**Seam C — the real provider. One assertion added, no new file.**
`tests/organize-faithfulness-smoke.test.ts` already asserts that a real model's Organize output
obeys a rule, and is skipped unless its gate is set. It gains one assertion: the returned
Category is a member of the closed set. This is the only place the prompt change can be checked
against a real model.

**Seam B is untouched.** Nothing here changes the LiveSync document format.

**The view has no seam, deliberately.** There is no component-test infrastructure in this repo
and none is introduced. The view is verified by the existing screenshot scripts, as the Field
Notebook was. This is affordable precisely because `listNotes` moves everything checkable below
the view: the grid is a thin render over a projection that is already proven at Seam A.

## Out of Scope

- **A Category management screen.** Adding a Category is a code change. There is no UI for
  renaming, adding or curating Categories or Tags.
- **User-picked Category colours.** Hue is derived. If this is wanted later it becomes stored
  data, and it must sync — see Further Notes.
- **Rewriting existing Notes' Categories.** No migration pass.
- **Voice capture.** Still deferred; the Capture sheet is text-only.
- **Note editing beyond Context.** Editing a Note happens in Obsidian.
- **Changing the five-second window.** The countdown makes it visible; whether five seconds is
  the right number is a separate question.
- **Reverting the second Organize at finalize.** Unchanged.
- **Component-test infrastructure.** Not introduced by this work.
- **Cross-device Pending state.** ADR-0005 stands; only its manual-reconciliation consequence
  changes.

## Further Notes

**Why Category had to be closed, with the evidence.** The Vault was read once during design.
It held **12 Notes carrying 11 distinct Categories** — `Troubleshooting` (2), `beverage`,
`Bug Report`, `Coffee`, `design`, `Hardware`, `learning`, `Personal`, `Productivity`,
`technical-issue`, `Tools`. Casing was inconsistent across them. The free-form prompt was
inventing a fresh Category almost every capture, so *no* colour scheme could have worked: at
roughly one colour per card, the hue would have looked meaningful and conveyed nothing. The
duplication was also semantic rather than orthographic — `Troubleshooting`, `Bug Report` and
`technical-issue` are one Category spelled three unrelated ways — so no normalization heuristic
would have collapsed them. The five members were chosen by clustering that evidence:
`troubleshooting` (4 Notes), `productivity` (3, absorbing `design` and `learning`), `tools` (2),
`coffee` (2), `personal` (1). This paragraph exists because the script that produced the
evidence was deliberately deleted; recovering it means reading the Vault again.

**The five names are a small sample.** Twelve Notes is thin, and several clusters were a single
Note. The set is expected to grow. That is why the list is append-only and why the hue rule
takes any number of members.

**If Category colours become user-chosen later**, they become data that must sync. Stored in
settings they would live in device-local IndexedDB, and the phone and the laptop would disagree
about what colour a Category is — the same trap that ruled out defining the Category set in
settings. The derived hue is the default that a stored override would replace, keyed by
Category name.

**The prototype branch stays as a primary source.** `prototype/rolodex` is never merged. Its
`prototype.html`, mockups and Impeccable critiques are the record of how this direction was
found. Its `spec.md`, `DESIGN.md` and `PRODUCT.md` predate the Stranded work and use words the
glossary rejects; this spec is the one to build from.

**What was traded away.** The Field Notebook's strict two-accent discipline is spent on
Category recognition. That is a real loss of restraint, taken deliberately for scanability, and
it is the thing to reconsider first if the grid ever starts to look busy.

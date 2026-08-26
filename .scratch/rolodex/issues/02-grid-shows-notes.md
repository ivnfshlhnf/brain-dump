# 02 — The grid shows my Notes

**What to build:** A grid of cards listing every **Note** the user has, added as a new view
beside the existing capture, ask and settings views. The Field Notebook keeps working
untouched — this is the new home arriving beside the old one, not replacing it yet.

Cards are neutral in this ticket. Colour arrives with 04.

Behind it, a new operation returns a card-sized projection of each Note, cached on the device
so the grid paints immediately and reconciles behind. The **Capture** path must never wait on
this read: the grid is the road to capture, and capture friction is the one unforgivable
failure.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] A grid view exists alongside the three existing views, and all three still work
- [ ] Every Note in the **Managed folder** appears as a card showing its **Category**, title, summary and date
- [ ] A card shows up to three **Tags** followed by a count of the remainder, so card heights stay uniform
- [ ] **Dumps**, the user's personal notes, and soft-deleted Notes never appear as cards
- [ ] The grid uses two columns on a phone and more on a laptop
- [ ] An empty **Vault** shows where the first card will land, rather than an error or a blank screen
- [ ] The projection is cached on the device and survives a restart
- [ ] An absent or unreadable cache is rebuilt from the Vault without user action
- [ ] A cold, failed or empty cache never blocks or delays the Capture control
- [ ] Tests at the operation-layer seam cover the projection's contents, the three exclusions, and cache durability across a simulated restart

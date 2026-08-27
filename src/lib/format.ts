// A date stamp in the Rolodex's mono voice: `MON DD · HH:MM`, uppercased, 24-hour. Dates are
// metadata you scan (DESIGN.md §Two Voices — serif reads, mono scans), so they read in Plex Mono
// at `--label` size. The stamp is pre-uppercased here so the string is honest even where CSS can't
// reach it (the accessibility tree, copy-to-clipboard); the stylesheet adds the 0.08em tracking.
//
// Local time, not UTC — a card's `createdAt` is the moment the thought was captured on the
// user's device, and the stamp is for the user recognizing that moment, not for cross-device
// chronology (the grid's reverse-chronological order carries that).
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);

/** `AUG 21 · 20:30` — the date+time stamp pinned to the foot of a card. */
export function formatStamp(ts: number): string {
  const d = new Date(ts);
  return `${MONTHS[d.getMonth()]} ${pad(d.getDate())} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
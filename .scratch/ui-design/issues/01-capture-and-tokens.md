**Status:** done

# 01 — The design system, and the Capture screen

**What to build:** A token system (colour, type, spacing, both colour schemes), self-hosted
fonts, and a redesigned Capture screen whose Note card shows the whole Note and carries the
autosave countdown on its own edge.

**Blocked by:** nothing.

## Done

- `src/app.css` — tokens, two faces, base elements, the Note card, the Ask answer.
- `src/App.svelte` — masthead and tabs, the Dump as the hero input, the full Note card,
  `savedNote` state so the card shows the written Note after the save.
- `index.html` — `color-scheme` and per-scheme `theme-color` meta.
- `vite.config.ts` — woff2 in the Workbox precache; manifest colours match the light ground.
- `public/fonts/` — Newsreader variable + IBM Plex Mono 400/500, with both OFL licences.

Tests 122 passed, typecheck 0 errors, build green, PWA precache 8 entries / 233.84 KiB.

## Not done

Visual verification. See the spec's Further Notes: the Note card has never been rendered.

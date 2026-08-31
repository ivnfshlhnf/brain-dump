**Status:** ready-for-agent

# 01 — Shell on the Host

**What to build:** The production build, hosted from `brain-dump.ivnhnf.com` via the
existing Cloudflare tunnel on the Proxmox Docker host, installed on the phone — the
installed PWA cold-starts with the Mac asleep.

**Blocked by:** nothing.

## Problem Statement

The phone's PWA is served from the Mac's Vite dev server behind `tailscale serve`, so every
cold load needs the Mac awake with the dev server running. The service-worker precaching the
repo already configures has never been active — it exists only in production builds, and no
production build has ever been installed. The offline shell is finished code waiting for an
origin that is always on.

## What to build

**In-repo (agent-ready):**

- The static server: a Caddyfile plus compose-service snippet for `caddy:alpine`, serving a
  volume-mounted build directory. Nothing rebuilds on deploy — the volume receives `dist/`.
- The offline-shell check: a self-starting member of the `scripts/check-*.mjs` family that
  builds, serves `dist` over `vite preview`, verifies the shell boots with the service
  worker active, then forces the page offline, reloads, and asserts the shell still paints
  and a capture still enrolls Pending. Wired into `npm test`. Prior art:
  `scripts/check-grid-loading.mjs` (self-start, `page.route`-held conditions, assert + handoff).
- Version line wording: the stamp already evaluates at build time; its description changes
  from "the commit this server was started from" to "the commit this build was made from".
  The guard in `tests/version.test.ts` follows.

**Guided human steps (run at the end, in this order):**

1. Cloudflare DNS: CNAME `brain-dump.ivnhnf.com` → the existing tunnel.
2. cloudflared ingress: add the hostname rule pointing at the Caddy container (port), bring
   the tunnel config live.
3. Start the Caddy container with the volume mounted.
4. CouchDB: add `https://brain-dump.ivnhnf.com` to the server's per-origin CORS list
   (`allow-credentials: true` rules out `*`). Same failure mode as the ts.net origin if
   skipped: silent load-failed from unknown origins.
5. Deploy: `npm run build`, copy `dist/` into the volume.
6. Phone: verify the app loads at the new URL, then install the PWA. (Pending store contents
   do not carry over — accepted, spec'd; the Vault reconciler is the backstop.)
7. Dev server demotion is nothing — it keeps running for Mac use, unchanged.

## Notes

- No new PWA machinery. The existing `vite-plugin-pwa` workbox configuration (all assets +
  fonts precached, `autoUpdate`) becomes active on the production origin by being the
  origin the phone installs from.
- The Host is public and access-free by decision — the shell is inert without CouchDB
  credentials. Do not add Cloudflare Access.
- Updates are lazy by decision; no skip-waiting. iOS PWAs update the SW on navigation —
  close-and-reopen after a redeploy is the expected pickup path (ticket 03 verifies).
- CONTEXT.md already defines **Host**; use the term.
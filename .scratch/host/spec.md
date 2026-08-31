Status: ready-for-agent

# The Host — the PWA that does not need the Mac

## Problem Statement

The phone's PWA is served from the Mac: the Vite dev server behind `tailscale serve`. Every
cold load of the app — every HTML page, every JS bundle, the fonts — comes from a laptop
that must be awake, running the dev server, and reachable on the tailnet. The consequence is
that grabbing the phone to capture a thought fails whenever the Mac is asleep or absent:
the app does not open at all.

The irony is that the app is already built for this. It carries `vite-plugin-pwa` with
workbox precaching configured (all assets, fonts included, `autoUpdate`), and it already
survives the Vault being unreachable — the Pending store enrolls every Dump at Capture,
before anything can fail. But the service worker is wired for production builds only, and
the phone has only ever been served the dev server. The offline machinery has never once
been active on the origin the phone uses. The app's offline half is finished; only the
serving half is missing.

## Solution

A production build hosted from an always-on place: **the Host** — a new origin
(`brain-dump.ivnhnf.com`), a static Caddy container on the Proxmox Docker home server,
published through the existing Cloudflare tunnel. The phone reinstalls from the Host once.
From then on the installed PWA cold-starts from its precached service worker, whether or
not the Mac exists. The Host serves updates lazily — a redeploy lands the next time the
phone visits — and never again stands in the path of a Capture, which talks to CouchDB and
the LLM provider directly, as it always has.

The dev server keeps its job: Mac-local dogfooding with the jsonl log sink. Because a
phone-only failure should be diagnosable after the fact even when no dev server is
involved, the app's in-memory log ring buffer gains persistence — it survives restarts —
and an Export that downloads the events in the same one-JSON-object-per-line format the
dev file uses, so one reading habit serves both origins.

The vocabulary for this lives in CONTEXT.md already: the **Host** is the always-on origin
the app itself is served from — the thing to be current with, never the Vault or its
database. The Host going away slows updates, not thoughts.

## User Stories

1. As a phone user, I want the installed PWA to open when my Mac is asleep, so that I can capture a thought the moment I have it.
2. As a phone user, I want the app shell precached by its service worker, so that a cold start does not depend on the Host being reachable.
3. As a phone user, I want a capture made while the Host is down to enroll as Pending exactly as any other, so that connectivity to the Host is never a precondition of capturing.
4. As a phone user, I want a capture made while the Vault (CouchDB) is unreachable to recover into its Note when the connection returns, so that offline thoughts are filed, not lost.
5. As a phone user, I want the app to pick up updates on my next visit after a redeploy, so that a capture is never interrupted to become current.
6. As a user, I want the Settings sheet to show the commit the running build was made from, so that I can tell whether the phone is serving what I just deployed.
7. As a user, I want to reinstall the PWA from the new Host once and never think about origins again, so that the install is the whole setup.
8. As a user, I want a thought stranded by the origin switch to surface as Stranded with a Retry, so that the Vault reconciler quietly catches what the install drop leaves behind.
9. As a phone user debugging a phone-only failure later, I want the log to survive closing the app, so that the evidence of what failed exists after the reload that killed the failure.
10. As a phone user, I want an Export action that downloads the log as one JSON object per line, so that what I hand to an agent reads exactly like the dev log file it already knows.
11. As an agent helping diagnose a phone failure, I want the exported log in the same format as the dev log, so that the existing parsing and grep habits apply unmodified.
12. As a user, I want the log bounded — old events evicted, nothing growing without limit — so that a long-lived PWA session cannot bloat in storage.
13. As a user, I want a Clear action alongside Export, so that a log full of a past failure can be wiped once understood.
14. As a Mac user, I want the dev server and its `logs/brain-dump.jsonl` sink unchanged, so that the existing dogfooding workflow and its scripts keep working.
15. As the operator of the Host, I want deploy to be "build, rsync the folder into the mounted volume", so that shipping an update is one command and no image push.
16. As the owner of the Vault, I want the app shell on the Host to be inert without my CouchDB credentials, so that a public URL exposes nothing but a login screen that leads nowhere.
17. As a future user on a new device, I want to install from the Host over the public internet, so that onboarding never involves a specific machine being awake.

## Implementation Decisions

- **Topology.** `brain-dump.ivnhnf.com` → Cloudflare (existing account) → existing cloudflared tunnel → a new `caddy:alpine` container on the Proxmox Docker host serving a volume-mounted build directory. Cloudflared's ingress gains one rule; Cloudflare DNS gains one CNAME. TLS terminates at Cloudflare's edge, riding the same story as `couchdb.ivnhnf.com`.
- **Exposure.** Public, deliberately without Cloudflare Access. The Host serves only the inert app shell — no Vault, no credentials, no data. Access was considered and rejected because Zero-Trust redirects can interfere with the PWA install and service-worker bootstrapping, which this thread exists to make reliable.
- **CORS.** CouchDB answers per-origin, and the browser's `Origin` header is the origin it sees regardless of tunnels. `https://brain-dump.ivnhnf.com` joins the server's CORS list (`allow-credentials: true` forbids a wildcard). This is the same failure the ts.net origin hit.
- **Offline shell.** The existing `vite-plugin-pwa` configuration — workbox precaching all assets including fonts, `registerType: 'autoUpdate'` — becomes active simply by installing from a production build. No new PWA machinery is introduced; `devOptions` stays off, demoting the dev server to Mac-local use.
- **Version line semantics.** The version stamp already evaluates the commit at build time, which is now the load-bearing path; its description changes from "the commit this server was started from" to "the commit this build was made from".
- **Update cadence.** Lazy: the service worker fetches the new version in the background, the phone sees it on next reload. No skip-waiting, no update prompt.
- **Persistent log.** The in-memory ring buffer behind the logging seam stays as the working buffer (human-readable `format()` and the existing Copy button unchanged). A persistence layer under it retains events across restarts — loaded back on boot, appended as events arrive — with its own eviction at ~200 events, oldest first. Storage is IndexedDB, as the Pending store already does.
- **Export shape.** Export writes one JSON object per line — the event object exactly as the dev sink serializes it — not the human-readable `format()` lines. The dev file's line format and the exported file are byte-compatible by construction. Export and Clear are Settings-sheet actions next to the existing Copy button.
- **Deploy.** Hand-run for now: `npm run build`, then copy `dist/` into the Caddy volume. No deploy script in this spec; one follows if the ritual gets annoying. The deploy is idempotent and rollback is "rsync the previous one back".

## Testing Decisions

A good test here exercises behavior at the seam the feature is actually used at, never internal wiring; the strongest assertions are against the built artifact, not the dev server.

1. **The built PWA over `vite preview` + Playwright.** The check builds, serves the real `dist` with service-worker support, asserts the shell boots, and then the decisive assertion: force the page offline, reload, and assert the shell still paints and a Capture still enrolls a Pending Dump. This is one self-starting check in the existing `scripts/check-*.mjs` family (prior art: `check-grid-loading.mjs` holds the Vault read open via `page.route`), wired into `npm test`.
2. **The logging seam.** Persistence and export are tested at `LogStore` — the seam the code itself names as the one tests are meant to use. Unit tests (prior art: `tests/logger.test.ts`) assert: events survive a simulated restart; exported output is one JSON object per line and matches what the dev sink would write for the same events; eviction keeps the newest; Clear leaves nothing; the sink contract is honored (a failing persistence attempt must never break logging).
3. **Ticket 3 has no automated seam, deliberately.** The environment under test — phone, tunnel, iOS PWA quirks — is the thing only reality provides. The ticket is a checklist executed against the real Host, results recorded in the ticket file.

## Out of Scope

- **No pre-reinstall Pending banner.** Decided against (2026-08-31): the Vault-side reconciler — Find stranded Dumps — is the backstop, and a stranded Dump surfaces rather than vanishes. A one-line warning was rejected as scope.
- **No Cloudflare Access** on the Host (decided: public, the shell is inert).
- **No deploy script / CI** — hand rsync until it hurts.
- **No skip-waiting / update prompt** — lazy updates only.
- **No work on onboarding friction** — the Setup URI import, the commonlib port, the E2EE gate: all parked in `.scratch/onboarding-friction/research.md` to be picked up later. The Host removes none of that scope and adds none.
- **No multi-device Pending sharing** — Pending state stays device-local per its ADR; the Vault remains the cross-device reconciler.
- **No change to the dev-server dogfooding setup** — tailscale serve, allowedHosts, the jsonl sink: untouched.

## Further Notes

- The Host coin: CONTEXT.md gained **Host** as part of this work. Keep using it — "serve server" meant three different things; the Host is exactly one.
- Ticket 1 contains steps only a human can take (Cloudflare dashboard CNAME, the tunnel ingress edit, the CouchDB CORS origin, the phone reinstall). An agent drafts every config in-repo and the human steps run guided at the end of the ticket.
- The reinstall is a new origin: Pending store contents do not carry over (device-local, and the store lives in origin-scoped storage). Deliberately accepted — see Out of Scope.
- iOS PWA service workers update only on navigation; "lazy" here means close-and-reopen the PWA after a redeploy. The verification ticket should confirm this behaves as expected rather than surprise later.
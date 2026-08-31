# Research: reducing onboarding friction without leaving the Obsidian vault

Date: 2026-08-30
Question: how does a new user get from "I have an Obsidian vault" to "brain-dump is
capturing" with less setup than "stand up a CouchDB, configure CORS, install LiveSync,
disable E2EE"? The vault stays the store of record — that constraint is fixed.

Every claim below is followed back to a primary source (official docs, published package
contents, or repository source). Where I inferred rather than verified, it says so.

---

## 1. What onboarding costs today

From this repo, not from memory:

- Six fields have no default: `couchdbUrl`, `couchdbDb`, `couchdbUser`, `couchdbPassword`,
  `llmApiKey`, and effectively `caseSensitive` (`src/lib/types.ts:289`).
- `caseSensitive` "must match LiveSync's *Handle files as Case-Sensitive* setting"
  (`README.md`). The user cannot know it without opening the plugin's settings, and getting
  it wrong silently produces wrong document IDs — `docIdForPath` lowercases on that flag
  (`src/lib/livesync.ts:23`).
- The vault **must be unencrypted**, because "external writes can't perform the plugin's
  crypto" (`docs/adr/0001-live-sync-couchdb-direct.md`). This is not friction — it is a hard
  gate. A user with E2EE on cannot use the app at all without rebuilding their vault.
- CouchDB must have CORS enabled. `[chttpd] enable_cors = false` is the default, and
  `[cors] origins = *` cannot be combined with `credentials = true`
  ([CouchDB config docs](https://docs.couchdb.org/en/stable/config/http.html)). Since the app
  authenticates with an `Authorization` header, every request is preflighted, so CORS
  configuration is unavoidable on this path — and each new app origin must be added by hand.
- The app hand-rolls LiveSync's document format (`src/lib/livesync.ts`), against a format with
  "no official external-write API yet"
  ([issue #795](https://github.com/vrtmrz/obsidian-livesync/issues/795), still open, labelled
  `addressed` + `documentation`).

So the real cost is: a server, a CORS edit, a plugin, a format gamble, and a vault that must
give up encryption.

---

## 2. The headline finding: LiveSync now publishes an integration library

**`@vrtmrz/livesync-commonlib` v0.1.19, MIT, on npm, last published 2026-08-24.**
Verified by downloading the tarball and reading its contents, not from a write-up.

Its README states the root entry point's intended use verbatim:

> | `@vrtmrz/livesync-commonlib` | `DirectFileManipulator` for integrations which access CouchDB directly |

That is precisely brain-dump's job description. ADR-0001's "there is no official
external-write API yet" was true when written and is now out of date.

`DirectFileManipulator` (`dist/API/DirectFileManipulatorV2.d.ts`) exposes:

```ts
get(path, metaOnly?)            // read one file
put(path, data, info, _type?)   // write one file
delete(path)
enumerateAllNormalDocs({metaOnly})   // read the whole vault
beginWatch(cb) / followUpdates(cb)   // live changes
$$path2id / $$id2path                // the canonical path <-> docID mapping
```

Its options type is the interesting part:

```ts
type DirectFileManipulatorOptions = {
  url; username; password; database;
  passphrase: string | undefined;          // <-- E2EE
  obfuscatePassphrase: string | undefined; // <-- path obfuscation
  E2EEAlgorithm?; hashAlg?; chunkSplitterVersion?;
  handleFilenameCaseSensitive?; enableCompression?; useEden?; ...
}
```

Three consequences, in descending order of value:

1. **The E2EE gate may be liftable.** `passphrase` and `obfuscatePassphrase` are first-class
   options. The two things ADR-0001 said an external writer cannot do are parameters here.
   *Not verified end-to-end* — this needs a Seam B run against a real E2EE vault before it
   goes in a README. But the API surface says the door exists.
2. **`caseSensitive` and the chunk format stop being brain-dump's problem.**
   `handleFilenameCaseSensitive`, `chunkSplitterVersion`, `hashAlg` and `useEden` are
   handled inside the library, by the people who define the format.
3. **`beginWatch`/`followUpdates` is a capability the app does not have today** — it re-reads
   the vault. Live updates would make the Rolodex reflect edits made in Obsidian.

### Setup URI import — the single biggest friction win

`dist/API/processSetting.d.ts` exports:

```ts
decodeSettingsFromSetupURI(uri: string, passphrase: string): Promise<false | ObsidianLiveSyncSettings>
decodeSettingsFromQRCodeData(qr: string): ObsidianLiveSyncSettings
```

The LiveSync plugin itself calls exactly this (`src/modules/features/SetupManager.ts:28,478`).
A Setup URI is `obsidian://setuplivesync?settings=…`, encrypted under its own passphrase,
generated from a working device via the command palette
([quick_setup.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/docs/quick_setup.md)).

**A user who already has LiveSync working can generate a Setup URI and paste it into
brain-dump.** Four CouchDB fields plus `caseSensitive` collapse into one paste and one
passphrase. There is also a QR path — which matters, because the phone PWA is the device
where typing a CouchDB password hurts most.

There is a lighter option too: `dist/common/ConnectionString.d.ts` parses a plain connection
string with no encryption involved —

```
sls+https://user:pass@host/path?db=NAME     -> {type:"couchdb", settings:{couchDB_URI, couchDB_USER, ...}}
sls+s3://…                                   -> {type:"s3", …}
sls+p2p:…                                    -> {type:"p2p", …}
```

That is ~30 lines to reimplement if you do not want the dependency, and it still turns four
fields into one.

### The honest caveats

The maintainer is explicit, in `readme.md` and `docs/proven-in-use.md`:

> It is not yet a general-purpose LiveSync SDK … The package is pre-1.0. Pin an exact
> reviewed version.

> `DirectFileManipulator` is useful for existing integrations, but its enumeration, watch
> ownership, failure, conflict, concurrency, readiness, and disposal semantics are not a
> stable high-level SDK contract. It is the migration source for the planned file client.

A `createLiveSyncFileClient` factory is planned for after LiveSync 1.0 but "is not
implemented yet". So: pin the exact version, keep Seam B as the tripwire, and expect one
migration later. That is still strictly better than hand-rolling the format with no
tripwire upstream.

**Bundle cost, measured.** Tracing the import graph of `DirectFileManipulatorV2.js` through
the shipped `dist`: 113 internal modules, 430 KB unminified, and these external deps —

```
pouchdb-core, pouchdb-adapter-http, pouchdb-find, pouchdb-replication,
pouchdb-merge, pouchdb-utils, pouchdb-mapreduce, pouchdb-errors,
transform-pouch, octagonal-wheels, fflate, idb, minimatch,
diff-match-patch, node:crypto
```

Notably **not** `@aws-sdk/client-s3` and **not** trystero, despite both being package-level
dependencies — the S3 and P2P remotes are behind other entry points. brain-dump already
ships `pouchdb-core` and `pouchdb-adapter-http`, so the marginal cost is real but modest.

One sharp edge: `dist/services/implements/headless/HeadlessAPIService.js:2` does
`import module from "node:crypto"` (to reach `module.webcrypto`), and it is reachable from
the DirectFileManipulator graph. A browser build needs a Vite alias to a shim that returns
`globalThis.crypto`. Cheap, but it will bite on first `npm run build` if unanticipated.

---

## 3. Paths that avoid CouchDB entirely

Each of these was checked against its own primary source. All of them keep notes in the
vault; they differ in *what moves the bytes*.

### 3a. File System Access API — write the vault folder directly

Zero servers, zero credentials, zero CORS, no LiveSync, no E2EE constraint. The app picks
the vault folder once and writes markdown files.

Handles persist: `FileSystemHandle` objects are storable in IndexedDB, and since **Chrome
122** installed PWAs get persistent permission automatically — "Installed apps will
automatically persist permissions once the user grants access. In this case, the three-way
prompt won't be shown"
([Chrome for Developers](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api)).
brain-dump is already an installed PWA, so this lands on the good side of that split.

LiveSync's own WebApp uses this approach, and commonlib ships the adapter:
`@vrtmrz/livesync-commonlib/browser` → `createFileSystemAccessStorage({ rootHandle })`.

**The killer.** Per [caniuse](https://caniuse.com/native-filesystem-api): Chrome desktop 105+
and Edge 105+ only. Firefox ✗, Safari desktop ✗, **Safari iOS ✗, Chrome Android ✗**, Samsung
Internet ✗, Firefox Android ✗. There is no mobile support at all, on any browser.

Given the phone PWA is a primary surface here, this cannot be the only path — but it is an
excellent *desktop* path, and it is the only option on this list with genuinely zero setup.

### 3b. Obsidian Local REST API plugin

The user installs one community plugin and copies an API key. No server, no CouchDB, no
CORS edit. From the
[plugin README](https://github.com/coddingtonbear/obsidian-local-rest-api): it serves
`/vault/{path}` with GET/PUT/PATCH/POST/DELETE, sends `Access-Control-Allow-Origin: *`, and
offers HTTPS on 27124 (self-signed) or optional plain HTTP on 27123.

Two verified facts decide its shape:

- **It binds to `127.0.0.1` only.** So the phone cannot reach it, even over the tailnet,
  without a proxy in front.
- **An HTTPS page *can* call `http://127.0.0.1:27123`.** Chrome's Private Network Access
  documentation states: "Requests targeting `http://localhost` (or `http://127.*.*.*`,
  `http://[::1]`) are not blocked by Mixed Content, even when issued from secure contexts"
  ([Chrome for Developers](https://developer.chrome.com/blog/private-network-access-update)).
  PNA enforcement itself is still on hold. So the plain-HTTP port works from the deployed
  PWA without the user trusting a self-signed cert.

Requires Obsidian to be running. Desktop-only, same as 3a, but with a lighter browser-support
story (works in Safari and Firefox, which 3a does not).

### 3c. Object storage + Remotely Save

The app writes plain markdown to an S3-compatible bucket; the user installs
[Remotely Save](https://github.com/remotely-save/remotely-save) and points it at the same
bucket. Per its README: free-tier support for S3/R2/B2/MinIO, Dropbox, OneDrive App Folder
and WebDAV; files are stored **at their vault-relative paths in original format** under a
`${vaultName}` subfolder; encryption is **optional and off by default** ("files and folders
are synced in plain, original content to the cloud"); and mobile Obsidian is explicitly
supported.

That last point matters — it is the only vault-side syncer on this list that is solid on
phones. Cloudflare R2 supports CORS configuration for browser access via dashboard or
`wrangler r2 bucket cors set`
([Cloudflare docs](https://developers.cloudflare.com/r2/buckets/cors/)).

Cost: the user creates a bucket and an API token, and the app must sign SigV4 in-browser.
Setup is comparable to CouchDB in *step count*, but there is no server to host and keep
reachable, and R2's free tier is generous. Note this trades one CORS edit for another.

### 3d. Git

App writes via GitHub's Contents API (`PUT /repos/{owner}/{repo}/contents/{path}`, base64
`content`, `sha` required on update —
[GitHub REST docs](https://docs.github.com/en/rest/repos/contents)); user installs
obsidian-git with auto-pull.

Rejected on the vault side, by its own maintainer: "The Git implementation on mobile is
**very unstable**! I would not recommend using this plugin on mobile, but try other syncing
services" ([obsidian-git README](https://github.com/Vinzent03/obsidian-git)) — no SSH on
mobile, memory-bound repo size, crashes on clone/pull. Fine for a desktop-only user, not a
foundation.

### 3e. Peer-to-peer — no server at all

LiveSync supports WebRTC P2P via Trystero over Nostr signalling relays; a signalling relay is
needed for discovery, TURN is an optional fallback
([LiveSync README](https://github.com/vrtmrz/obsidian-livesync)). The user configures a Room
ID, a passphrase and a device name — no server, no CORS, no credentials to a database.

The proof this is reachable from a browser app is **WebPeer**: a "pure client-side
web-application that can be connected to Self-hosted LiveSync in peer-to-peer", living in
`vrtmrz/livesync-commonlib` under `apps/webpeer`, with a hosted instance at
`fancy-syncing.vrtmrz.net/webpeer`. commonlib's `readme.md` names WebApp and WebPeer as
maintained consumers of the same package brain-dump would depend on.

The catch is structural, and it is the same one the app's own vocabulary already names: P2P
requires the Obsidian peer to be **online at the same time**. A capture on the phone at 2am
has no peer to hand it to. That is survivable — it is exactly what **Pending** means
(`CONTEXT.md`) — but Retrieve would need a local replica, and `enumerateAllNormalDocs` over a
local PouchDB would actually be *faster* than today's HTTP read. For an always-on peer there
is [livesync-serverpeer](https://github.com/vrtmrz/livesync-serverpeer) (Deno + Docker), now
folded into the LiveSync CLI — but that reintroduces the always-on component ADR-0001
rejected.

Highest ceiling, highest effort. `apps/webpeer` is the reference implementation to read
before committing to it.

---

## 4. Recommendation

Onboarding friction is not one problem. It is a **prerequisite** problem (you must already
run CouchDB) and a **data-entry** problem (six fields, one of which you cannot know). They
have different fixes and very different costs.

**Do first — cheap, no architectural change:**

1. **Setup URI / connection-string import.** Either depend on `processSetting` or
   reimplement `ConnectionStringParser` (~30 lines). Turns 5 fields into 1 paste. The QR
   variant fixes the phone specifically. This is the highest value-per-hour item on the page
   and it changes nothing about how the app writes.
2. **Read `caseSensitive` from the imported settings** instead of asking. It is the field
   most likely to be set wrong, and it fails silently.

**Do next — the structural fix:**

3. **Adopt `@vrtmrz/livesync-commonlib`'s `DirectFileManipulator` behind a `Vault` port,
   pinned to 0.1.19.** `src/lib/livesync.ts` becomes an adapter rather than a
   reimplementation, ADR-0001's format gamble becomes an upstream dependency with a real
   tripwire, and — pending Seam B verification — the E2EE gate may come down, which converts
   a population of users from "cannot use this" to "can". The seam is already almost right:
   `DocStore` (`src/lib/types.ts:252`) is CouchDB-shaped, but `livesync.ts`'s
   `readVaultFiles`/`writeFile`/`modifyFile` is already the vault-shaped interface the rest
   of the app talks through.

**Then, once the port exists — pick up the cheap backends:**

4. **File System Access adapter for desktop Chromium.** Zero-setup onboarding for laptop
   users, and once there is a `Vault` port it is a small adapter with an existing
   implementation to copy (`@vrtmrz/livesync-commonlib/browser`). Must be offered *alongside*
   CouchDB, never instead — it does not exist on any phone.
5. **Local REST API adapter**, if desktop-only-with-Obsidian-running is an acceptable mode.
   One plugin install and one API key is the lowest-friction *cross-browser* desktop option.

**Do not do yet:** P2P (highest ceiling, but needs the always-on-peer question answered
first), git (maintainer says mobile is unstable), object storage (real, but it swaps one
bucket+token+CORS setup for another — only worth it if dropping the CouchDB *prerequisite*
turns out to matter more than reducing its *steps*).

The ordering matters: items 1–2 make the current architecture much less painful in a day or
two, and item 3 is what makes 4 and 5 cheap instead of duplicative.

---

## 5. Open questions, and how to settle them

| Question | How to answer it |
| --- | --- |
| Does `DirectFileManipulator` actually round-trip an **E2EE** vault? | Seam B against a real CouchDB with `passphrase` set; assert LiveSync's reader accepts it. This decides whether ADR-0001's hardest constraint falls. |
| Does the commonlib graph build clean for the browser? | `npm i @vrtmrz/livesync-commonlib@0.1.19` and `npm run build`. Expect to alias `node:crypto` → a `{ webcrypto: globalThis.crypto }` shim. |
| Real bundle delta? | Build before/after. 430 KB raw traced, but heavily overlapping with the PouchDB already shipped. |
| Is `useEden` / `chunkSplitterVersion` v2/v3 already in use in the live vault? | Read the LiveSync plugin's settings on the dogfooding device. If the current hand-rolled writer has been getting away with v1 chunks, that is luck, not design. |
| Does the phone's camera path make QR import worth it over paste? | Cheap to answer by trying paste first; QR only if pasting a Setup URI onto the phone is the thing that actually hurts. |

---

## Sources

- [vrtmrz/obsidian-livesync README](https://github.com/vrtmrz/obsidian-livesync) — backends, P2P, Setup URI
- [obsidian-livesync docs/quick_setup.md](https://github.com/vrtmrz/obsidian-livesync/blob/main/docs/quick_setup.md)
- [obsidian-livesync issue #795](https://github.com/vrtmrz/obsidian-livesync/issues/795) — external-write format requirements
- `@vrtmrz/livesync-commonlib@0.1.19` package contents (`npm pack`) — `dist/index.d.ts`, `dist/API/DirectFileManipulatorV2.d.ts`, `dist/API/processSetting.d.ts`, `dist/common/ConnectionString.js`, `readme.md`, `docs/proven-in-use.md`, `docs/remote-configurations.md`, `docs/p2p-transport-lifecycle.md`
- [vrtmrz/livesync-commonlib](https://github.com/vrtmrz/livesync-commonlib) — MIT, default branch `main`, `apps/webpeer`
- [vrtmrz/livesync-serverpeer](https://github.com/vrtmrz/livesync-serverpeer)
- [CouchDB HTTP/CORS configuration](https://docs.couchdb.org/en/stable/config/http.html)
- [caniuse: File System Access API](https://caniuse.com/native-filesystem-api)
- [MDN: showDirectoryPicker()](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker)
- [Chrome: Persistent permissions for the File System Access API](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api)
- [Chrome: Private Network Access update](https://developer.chrome.com/blog/private-network-access-update)
- [coddingtonbear/obsidian-local-rest-api](https://github.com/coddingtonbear/obsidian-local-rest-api)
- [remotely-save/remotely-save](https://github.com/remotely-save/remotely-save)
- [Cloudflare R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/)
- [Vinzent03/obsidian-git](https://github.com/Vinzent03/obsidian-git)
- [GitHub REST: repository contents](https://docs.github.com/en/rest/repos/contents)

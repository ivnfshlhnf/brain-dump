// The manual update action (host ticket 03's follow-up): Settings → Check for updates.
//
// Check-only, by decision (2026-09-01, after the reload-and-restore design proved more
// machinery than the moment needs): the press fetches the newest worker *now* and says
// what it found; it never reloads the page. The service worker already updates lazily —
// iOS fetches the new worker on navigation, and `registerType: 'autoUpdate'` means a
// fetched worker skips waiting and claims immediately — so a found update serves on the
// next app reopen, exactly like the lazy path. What the button buys is knowing *now*:
// the deploy happened, this press fetched it, the next reopen runs it.
//
// The decision — pending / current / unavailable — lives behind a structural
// UpdateClient so it is testable without a service worker (tests/update-check.test.ts)
// and the App.svelte wiring stays thin.

/** The slice of ServiceWorkerContainer the decision needs: the controller (identity
 *  change = a new worker already claimed the page) and the registration lookup. */
export interface UpdateClient {
  controller: ServiceWorker | null;
  getRegistration(): Promise<ServiceWorkerRegistration | undefined>;
}

export type UpdateCheck =
  | 'pending' // a newer build was found and downloaded — it serves on next reopen
  | 'current' // nothing newer at the Host
  | 'unavailable'; // not an installed app here, or the Host could not be reached

/** Ask the Host whether there is a newer build, download it into this install, and
 *  report what happened. Never throws — this backs a Settings action, and an update
 *  check must not crash the sheet it lives in. */
export async function checkForUpdate(opts: {
  /** Defaulted to `navigator.serviceWorker` in a browser that has one; injectable for
   *  tests (and plainly absent elsewhere, which makes every outcome 'unavailable'). */
  source?: UpdateClient;
} = {}): Promise<UpdateCheck> {
  const client =
    opts.source ?? (navigatorDefault() ? (navigator.serviceWorker as UpdateClient) : undefined);

  if (!client) return 'unavailable';

  try {
    const registration = await client.getRegistration();
    if (!registration) return 'unavailable'; // never installed: updates are not a thing here
    const before = client.controller; // identity: a different controller after = a claim
    await registration.update(); // fetch the newest worker script from the Host
    // A found update moves fast — the worker calls skipWaiting as soon as it evaluates,
    // and a LAN precache finishes in well under a second — and engines differ in whether
    // `update()` resolves before or after that run. So "something newer exists" is any of
    // the phases the worker can already have reached: still `installing`, `waiting` for
    // its claim, or past both and holding the page (a new controller). `installing` alone
    // is only the truth on engines that resolve earliest — reading it alone is what told
    // the phone "This is the latest build." while the new worker had it (2026-09-01).
    if (!registration.installing && !registration.waiting && client.controller === before) {
      return 'current';
    }
    return 'pending'; // downloaded; the next reopen serves it — the press stays put
  } catch {
    // The Host was unreachable (offline, or mid-deploy) or there is no SW at all.
    return 'unavailable';
  }
}

/** `navigator.serviceWorker` exists only in a secure-context browser; this keeps the
 *  default narrow and testable. */
function navigatorDefault(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}
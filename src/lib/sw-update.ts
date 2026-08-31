// The manual update action (host ticket 03's follow-up): Settings → Check for updates.
//
// The service worker already updates lazily — iOS fetches the new worker on navigation,
// and `registerType: 'autoUpdate'` means a fetched worker skips waiting and claims
// immediately. The button is that same mechanism, user-initiated: fetch the newest worker
// *now*, and if it takes over, reload into it at once. The lazy path stays the default;
// this is for the moment a deploy just happened and "open and close twice" feels blind.
//
// The decision — applied / pending / current / unavailable — lives behind a structural
// UpdateClient so it is testable without a service worker (tests/update-check.test.ts)
// and the App.svelte wiring stays thin.

/** The slice of ServiceWorkerContainer the decision needs: registration lookup and the
 *  `controllerchange` event (the claim, fired by skipWaiting + clientsClaim). */
export interface UpdateClient {
  controller: ServiceWorker | null;
  getRegistration(): Promise<ServiceWorkerRegistration | undefined>;
  addEventListener(type: string, listener: () => void, options?: { once?: boolean }): void;
}

export type UpdateCheck =
  | 'applied' // a new worker claimed the page — reloaded into it
  | 'pending' // an update was found but has not claimed yet — it serves on next reopen
  | 'current' // nothing newer at the Host
  | 'unavailable'; // not an installed app here, or the Host could not be reached

/** How long a found-but-not-yet-active worker gets to claim the page before the press is
 *  reported as `pending`. Precache is a few hundred KiB; 15s is generous and still bounds
 *  the wait. */
const DEFAULT_TAKEOVER_MS = 15_000;

/** Ask the Host whether there is a newer build, apply it into this page if it claims the
 *  page now, and report what happened. Never throws — this backs a Settings action, and
 *  an update check must not crash the sheet it lives in. */
export async function checkForUpdate(opts: {
  /** Defaulted to `navigator.serviceWorker` in a browser that has one; injectable for
   *  tests (and plainly absent elsewhere, which makes every outcome 'unavailable'). */
  source?: UpdateClient;
  /** Test hook: how long a found-but-silent install may keep the page waiting. */
  takeoverMs?: number;
  /** The "applied" action, defaulted to `location.reload()` — injectable so it is
   *  observable without a real navigation. */
  reload?: () => void;
} = {}): Promise<UpdateCheck> {
  const client =
    opts.source ?? (navigatorDefault() ? (navigator.serviceWorker as UpdateClient) : undefined);

  if (!client) return 'unavailable';

  // The claim fires as `controllerchange` — skipWaiting + clientsClaim make a new worker
  // take the page the instant it activates. The listener is disarmed when the press is
  // answered any other way: a `pending` worker goes on to claim whenever it finishes
  // precaching, possibly minutes later, and if this listener still fired then the page
  // would reload itself long after the user walked away — a capture interrupted to
  // become current, exactly what the spec's lazy cadence refuses (it serves next reopen).
  let armed = true;
  const takeover = new Promise<boolean>((resolve) => {
    client.addEventListener('controllerchange', () => {
      if (armed) resolve(true);
    });
  });
  try {
    const registration = await client.getRegistration();
    if (!registration) return 'unavailable'; // never installed: updates are not a thing here
    await registration.update(); // fetch the newest worker script from the Host
    // `installing` is non-null exactly when the check found a newer worker.
    if (!registration.installing) return 'current';
  } catch {
    // The Host was unreachable (offline, or mid-deploy) or there is no SW at all.
    return 'unavailable';
  }

  const took = await Promise.race([
    takeover,
    delay(opts.takeoverMs ?? DEFAULT_TAKEOVER_MS).then(() => false),
  ]);
  if (!took) {
    armed = false; // the listener may still fire when the worker claims — it must not reload
    return 'pending'; // still precaching; the next reopen serves it
  }
  opts.reload?.();
  return 'applied';
}

/** A plain timer as a promise, so the takeover race is readable. */
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** `navigator.serviceWorker` exists only in a secure-context browser; this keeps the
 *  default narrow and testable. */
function navigatorDefault(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}
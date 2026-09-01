// The manual update action (Settings → Check for updates): check-only, by decision
// (2026-09-01). It fetches the newest worker and reports; it never reloads the page —
// a found update serves on the next app reopen, like the lazy cadence itself. What is
// testable is the decision — pending / current / unavailable — which lives in its own
// function (src/lib/sw-update.ts) so the browser chrome around it can stay thin.
import { describe, it, expect } from 'vitest';
import { checkForUpdate, type UpdateClient } from '../src/lib/sw-update';

/** A fake ServiceWorkerContainer: registration optional; the controller identity is
 *  mutable, so a test's `update()` can land a claim the way skipWaiting+clientsClaim do. */
function fakeClient(opts: { controller?: object } = {}) {
  const client = {
    controller: opts.controller ?? null,
    getRegistration: async () => undefined as ServiceWorkerRegistration | undefined,
  };
  return {
    client: client as unknown as UpdateClient,
    /** Simulate a new service worker claiming the page — the identity changes. Only
     *  identity matters; the value says what the new controller is. */
    takeOver: (worker: object = { claimed: true }) => {
      client.controller = worker;
    },
  };
}

/** A fake registration: `update()` is the DOM's name for fetching the newest worker
 *  script. A found update shows up in `installing` (fetch found it, still precaching),
 *  `waiting` (install finished, claim pending) — or nowhere but the claim, on engines
 *  where `update()` resolves only after the whole install finished. */
function fakeRegistration(
  opts: { installing?: object; waiting?: object; update?: () => Promise<void> } = {},
) {
  return {
    installing: opts.installing ?? null,
    waiting: opts.waiting ?? null,
    update: opts.update ?? (async () => {}),
  } as unknown as ServiceWorkerRegistration;
}

const installing = { state: 'installing' } as unknown as ServiceWorker;

describe('checkForUpdate', () => {
  it('says so when there is no service-worker container to ask', async () => {
    expect(await checkForUpdate({ source: undefined })).toBe('unavailable');
  });

  it('says so when this origin never registered a worker', async () => {
    const { client } = fakeClient(); // getRegistration → undefined: not installed
    expect(await checkForUpdate({ source: client })).toBe('unavailable');
  });

  it('says so when the update check cannot reach the Host', async () => {
    // Offline: `registration.update()` rejects — the honest answer is still "unavailable",
    // not an error the user can do anything about.
    const { client } = fakeClient({ controller: {} });
    client.getRegistration = async () =>
      fakeRegistration({
        update: async () => {
          throw new TypeError('Failed to fetch');
        },
      });
    expect(await checkForUpdate({ source: client })).toBe('unavailable');
  });

  it('reports current when nothing newer was found', async () => {
    const { client } = fakeClient({ controller: {} });
    client.getRegistration = async () => fakeRegistration();
    expect(await checkForUpdate({ source: client })).toBe('current');
  });

  it('reports pending when the fetch found a worker still installing', async () => {
    const { client } = fakeClient({ controller: {} });
    client.getRegistration = async () => fakeRegistration({ installing });
    expect(await checkForUpdate({ source: client })).toBe('pending');
  });

  it('reports pending when the found worker is waiting for its claim', async () => {
    const { client } = fakeClient({ controller: {} });
    client.getRegistration = async () => fakeRegistration({ waiting: {} });
    expect(await checkForUpdate({ source: client })).toBe('pending');
  });

  it('reports pending — not current — when the new worker finished and claimed before update() resolved', async () => {
    // The phone's case (2026-09-01): WebKit resolves `update()` only after the found
    // worker finished installing; skipWaiting+clientsClaim have already claimed by then,
    // so `installing` is null. Reading that snapshot alone answered "This is the latest
    // build." while the new worker held the page. The claim during the check is the
    // truth: something newer exists, and the reopen will serve it.
    const { client, takeOver } = fakeClient({ controller: { old: true } });
    client.getRegistration = async () =>
      fakeRegistration({
        update: async () => {
          await Promise.resolve();
          takeOver(); // the claim lands while `update()` is still settling
        },
      });
    expect(await checkForUpdate({ source: client })).toBe('pending');
  });
});

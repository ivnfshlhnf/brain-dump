// The manual update action (Settings → Check for updates). The service worker already
// updates lazily on navigation; the button is the same mechanism, user-initiated: fetch
// the newest worker now, and if it takes over, reload into it. What is testable is the
// decision — current / pending / applied / unavailable — which lives in its own function
// (src/lib/sw-update.ts) so the browser chrome around it can stay thin.
import { describe, it, expect } from 'vitest';
import { checkForUpdate, type UpdateClient } from '../src/lib/sw-update';

/** A fake ServiceWorkerContainer: registration optional, controllerchange fires when the
 *  test says so (as skipWaiting+clientsClaim make it fire when a new worker activates). */
function fakeClient(opts: { controller?: object } = {}) {
  const listeners: Array<() => void> = [];
  const client = {
    controller: opts.controller ?? null,
    getRegistration: async () => undefined,
    addEventListener(_type: string, cb: () => void) {
      listeners.push(cb);
    },
  };
  return {
    client: client as unknown as UpdateClient,
    /** Simulate a new service worker claiming the page. */
    takeOver: () => listeners.forEach((l) => l()),
  };
}

/** A fake registration: `update()` is the DOM's name for fetching the newest worker
 *  script; `installing` is non-null exactly when the fetch found something newer. */
function fakeRegistration(opts: { installing?: object; update?: () => Promise<void> } = {}) {
  return {
    installing: opts.installing ?? null,
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
    expect(await checkForUpdate({ source: client, takeoverMs: 10 })).toBe('unavailable');
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
    const result = await checkForUpdate({ source: client, takeoverMs: 10 });
    expect(result).toBe('unavailable');
  });

  it('reports current when nothing newer was found', async () => {
    const { client } = fakeClient({ controller: {} });
    client.getRegistration = async () => fakeRegistration();
    expect(await checkForUpdate({ source: client, takeoverMs: 10 })).toBe('current');
  });

  it('reports applied and reloads when the new worker takes over', async () => {
    const { client, takeOver } = fakeClient({ controller: {} });
    let reloaded = false;
    client.getRegistration = async () =>
      fakeRegistration({
        installing,
        update: async () => {
          await Promise.resolve();
          takeOver(); // skipWaiting + clientsClaim: the new worker claims the page
        },
      });
    const outcome = await checkForUpdate({ source: client, takeoverMs: 1000, reload: () => (reloaded = true) });
    expect(outcome).toBe('applied');
    expect(reloaded).toBe(true);
  });

  it('reports pending when an update was found but has not taken over yet', async () => {
    // The found worker is still precaching; it activates on its own, but the page is left
    // on the old shell — "pending", which the phone sees as "fresh on next reopen".
    const { client } = fakeClient({ controller: {} });
    client.getRegistration = async () => fakeRegistration({ installing });
    const outcome = await checkForUpdate({
      source: client,
      takeoverMs: 10,
      reload: () => {
        throw new Error('must not reload a pending update');
      },
    });
    expect(outcome).toBe('pending');
  });

  it('does not reload on a late claim after answering pending', async () => {
    // The `pending` answer already went out; the found worker finishes precaching and
    // claims the page whenever it likes — possibly minutes later. That claim must serve
    // the *next* reopen, not reload a page the user has walked away from: a spontaneous
    // reload is exactly the capture interruption the lazy cadence exists to prevent.
    const { client, takeOver } = fakeClient({ controller: {} });
    client.getRegistration = async () => fakeRegistration({ installing });
    let reloaded = false;
    const outcome = await checkForUpdate({
      source: client,
      takeoverMs: 10,
      reload: () => (reloaded = true),
    });
    expect(outcome).toBe('pending');
    takeOver(); // the worker claims — off the press, long after the answer
    expect(reloaded).toBe(false);
  });
});
// PouchDB configured with the http adapter, for talking to the LiveSync CouchDB backend.
import PouchDB from 'pouchdb-core';
import http from 'pouchdb-adapter-http';
import type { DocStore, Settings } from './types';

PouchDB.plugin(http);

export function createRemoteDb(settings: Settings): DocStore {
  // Strip a trailing slash from the URL (if any) and join with a single slash. Do NOT
  // collapse every run of slashes — that would eat the `://` scheme (`http://` → `http:/`)
  // and the http adapter would reject the URL as having no matching adapter.
  const url = `${settings.couchdbUrl.replace(/\/+$/, '')}/${settings.couchdbDb}`;
  return new PouchDB(url, {
    auth: { username: settings.couchdbUser, password: settings.couchdbPassword },
  }) as unknown as DocStore;
}

/** Server-level database operations, kept separate from `DocStore` (which is scoped to one
 *  database). Only the health check uses this: creating a database needs server-admin rights
 *  on CouchDB 3.x, and whether the configured account has them decides whether the embedding
 *  cache can live in a sibling database (ADR-0004) or must fall back to per-device storage.
 *
 *  An interface rather than bare fetch calls, so the health check can be driven with a fake
 *  and no test ever touches a real server. */
export interface DatabaseAdmin {
  exists(name: string): Promise<boolean>;
  /** Create the database. Throws if the server refuses (no permission, unreachable). */
  create(name: string): Promise<void>;
  destroy(name: string): Promise<void>;
}

export function createDatabaseAdmin(settings: Settings): DatabaseAdmin {
  const base = settings.couchdbUrl.replace(/\/+$/, '');
  const headers = {
    Authorization: 'Basic ' + toBase64(`${settings.couchdbUser}:${settings.couchdbPassword}`),
  };
  const call = async (name: string, method: 'GET' | 'PUT' | 'DELETE') =>
    fetch(`${base}/${encodeURIComponent(name)}`, { method, headers });

  return {
    async exists(name) {
      const res = await call(name, 'GET');
      if (res.status === 404) return false;
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return true;
    },
    async create(name) {
      const res = await call(name, 'PUT');
      // 412 means it already exists, which still proves the account may address it.
      if (!res.ok && res.status !== 412) {
        throw new Error(`${res.status} ${res.statusText}`);
      }
    },
    async destroy(name) {
      const res = await call(name, 'DELETE');
      if (!res.ok && res.status !== 404) {
        throw new Error(`${res.status} ${res.statusText}`);
      }
    },
  };
}

/** Base64 for the basic-auth header, in the browser or in Node. */
function toBase64(s: string): string {
  if (typeof btoa === 'function') return btoa(s);
  return Buffer.from(s, 'utf8').toString('base64');
}

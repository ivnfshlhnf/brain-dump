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
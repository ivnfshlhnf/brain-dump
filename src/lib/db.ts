// PouchDB configured with the http adapter, for talking to the LiveSync CouchDB backend.
import PouchDB from 'pouchdb-core';
import http from 'pouchdb-adapter-http';
import type { DocStore, Settings } from './types';

PouchDB.plugin(http);

export function createRemoteDb(settings: Settings): DocStore {
  const url = `${settings.couchdbUrl}/${settings.couchdbDb}`.replace(/\/+/g, '/');
  return new PouchDB(url, {
    auth: { username: settings.couchdbUser, password: settings.couchdbPassword },
  }) as unknown as DocStore;
}
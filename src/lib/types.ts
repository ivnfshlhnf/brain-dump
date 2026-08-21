// Domain types — see CONTEXT.md for the glossary these names come from.

export type Modality = 'text' | 'voice';

/** A raw, immutable record of a single brain-dump. */
export interface Dump {
  id: string;
  content: string; // verbatim capture
  createdAt: number; // ms epoch
  modality: Modality;
}

/** A minimal read/write interface over the LiveSync CouchDB store.
 *  Satisfied by a PouchDB instance (http adapter in the app, memory adapter in tests). */
export interface DocStore {
  put(doc: Record<string, unknown>): Promise<{ id: string; rev: string }>;
  get<T = Record<string, unknown>>(id: string): Promise<T>;
  allDocs<T = Record<string, unknown>>(
    opts?: { include_docs?: boolean },
  ): Promise<{ rows: Array<{ doc: T | undefined }> }>;
}

export interface Settings {
  // CouchDB / LiveSync
  couchdbUrl: string;
  couchdbDb: string;
  couchdbUser: string;
  couchdbPassword: string;
  managedFolder: string; // e.g. "Brain Dump"
  dumpsFolder: string; // e.g. "_dumps"
  caseSensitive: boolean; // LiveSync "Handle files as Case-Sensitive" (default off)
  hashAlgorithm: 'sha1' | 'xxhash'; // must match the user's LiveSync chunk hash
  // Cloud LLM / embedder (used by later tickets)
  llmProvider: string;
  llmModel: string;
  llmApiKey: string;
  embedderModel: string;
}

export const DEFAULT_SETTINGS: Settings = {
  couchdbUrl: '',
  couchdbDb: '',
  couchdbUser: '',
  couchdbPassword: '',
  managedFolder: 'Brain Dump',
  dumpsFolder: '_dumps',
  caseSensitive: false,
  hashAlgorithm: 'sha1',
  llmProvider: '',
  llmModel: '',
  llmApiKey: '',
  embedderModel: '',
};
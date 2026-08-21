// Domain types — see CONTEXT.md for the glossary these names come from.

export type Modality = 'text' | 'voice';

/** A raw record of a single brain-dump. During the capture session the user may
 *  add Context, which edits the Dump while preserving the verbatim original inside
 *  it (`content`). Once the Note is saved the Dump is frozen and never changes. */
export interface Dump {
  id: string;
  content: string; // verbatim capture — the original, preserved inside the Dump
  context: string; // added Context during the review session; '' until added
  createdAt: number; // ms epoch
  modality: Modality;
}

/** The organized, editable artifact derived from one or more Dumps.
 *  See CONTEXT.md. Frontmatter holds the v1 schema; the body holds the
 *  cleaned content plus Summary/Key points/Related sections. */
export interface Note {
  title: string;
  tags: string[];
  createdAt: number; // ms epoch — the source Dump's capture time
  modality: Modality;
  source: string; // Obsidian wikilink to the source Dump
  category: string;
  summary: string;
  body: string; // cleaned/organized content
  keyPoints: string[];
  related: string[]; // wikilinks / urls
}

/** The structured result an LLM returns when Organizing a Dump into a Note. */
export interface OrganizeOutput {
  title: string;
  tags: string[];
  category: string;
  summary: string;
  keyPoints: string[];
  related: string[];
  body: string; // cleaned/organized content
}

/** The cloud-LLM seam. The operation layer depends on this interface; tests
 *  pass a deterministic fake, the app passes the real cloud Organizer. */
export interface Organizer {
  organize(content: string, modality: Modality): Promise<OrganizeOutput>;
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
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

/** A lightweight projection of an existing Note used for matching — path, title,
 *  tags, summary (enough to judge tags/topic overlap). The `path` is the vault-relative
 *  path and identifies the Note. Reading candidates does fetch each Note's chunk (a
 *  full-vault read, per ADR-0002); this projection discards the body. */
export interface NoteCandidate {
  path: string; // vault-relative path — identifies the existing Note
  title: string;
  tags: string[];
  summary: string;
}

/** The LLM's raw new-vs-append suggestion. `append` carries the candidate `path`;
 *  the operation layer validates the path is still a known candidate before trusting it. */
export type MatchSuggestion = { kind: 'new' } | { kind: 'append'; path: string };

/** The LLM-assisted matching seam. Given the new Dump's topic (the initial Organize
 *  preview's title/tags/summary) and the existing Note candidates, decide new vs
 *  append. Embedding-based matching is deferred until Retrieve (06) lands. */
export interface Matcher {
  match(
    topic: { title: string; tags: string[]; summary: string },
    candidates: NoteCandidate[],
  ): Promise<MatchSuggestion>;
}

/** A file read out of the vault for Retrieve: its vault-relative path, a display
 *  title (the frontmatter title, or the filename for a personal note that has none),
 *  and its full reassembled content. Deliberately not called a Note — Retrieve reads
 *  the app's organized Notes and the user's own personal notes alike (ADR-0002), and
 *  only the former are Notes in the glossary's sense. */
export interface VaultDoc {
  path: string;
  title: string;
  content: string;
}

/** The cloud embedder seam. v1 re-embeds on every query (no persistent index), so
 *  this is called with the whole vault each time. Tests pass a deterministic fake. */
export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

/** The synthesized answer plus the sources it drew on, as indexes into the docs the
 *  Answerer was given — the same shape as the Matcher's validated `index`, and
 *  validated the same way: the operation layer owns what may be cited, so a model
 *  that invents an index cannot produce a dead link. An empty `sources` means the
 *  model drew on nothing, which is a real answer ("I couldn't find that"). */
export interface AnswerOutput {
  answer: string;
  sources: number[];
}

/** The Related-judgment seam. Given a new Note and a shortlist of the vault documents
 *  closest to it, decide which are *genuinely* Related rather than merely similar-sounding.
 *
 *  It returns indexes into `candidates`, never paths. The model selects from a list the app
 *  built from the vault, so a link to a document that does not exist is impossible by
 *  construction — the same discipline `Answerer` uses for citations. */
export interface Relater {
  related(
    subject: { title: string; summary: string; content: string },
    candidates: VaultDoc[],
  ): Promise<number[]>;
}

/** The answer-synthesis seam (RAG's generation half). Given the question and the
 *  most relevant vault docs, produce an answer that cites them. */
export interface Answerer {
  answer(question: string, sources: VaultDoc[]): Promise<AnswerOutput>;
}

/** A source the answer drew on, as a path plus an Obsidian wikilink the user can open. */
export interface Citation {
  path: string;
  title: string;
  link: string;
}

/** What Retrieve returns: a synthesized answer plus the Notes it cited. */
export interface RetrieveResult {
  answer: string;
  citations: Citation[];
}

/** The offline queue seam: Dumps captured with no connection wait here until a
 *  reconnect syncs them to CouchDB and Organizes them into Notes. A queued Dump is
 *  a Dump — it carries the id and capture time assigned at capture, so once synced
 *  it is dated by when the thought occurred, not by when the connection came back.
 *  The operation layer depends on this interface; the app passes the durable
 *  IndexedDB outbox (see `outbox.ts`). */
export interface OutboxStore {
  /** Queue a Dump, keyed by its id — re-adding the same Dump replaces it. */
  add(dump: Dump): Promise<void>;
  /** Queued Dumps in capture order (FIFO). */
  list(): Promise<Dump[]>;
  remove(id: string): Promise<void>;
}

/** A minimal read/write interface over the LiveSync CouchDB store.
 *  Satisfied by a PouchDB instance (http adapter in the app, memory adapter in tests). */
export interface DocStore {
  put(doc: Record<string, unknown>): Promise<{ id: string; rev: string }>;
  get<T = Record<string, unknown>>(id: string): Promise<T>;
  allDocs<T = Record<string, unknown>>(
    opts?: { include_docs?: boolean; limit?: number; keys?: string[] },
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
  /** The Obsidian vault name on *this* device — used to build `obsidian://open?vault=…&file=…`
   *  links back into the Vault. Per-device (the vault may be named differently on the laptop
   *  and the phone); empty falls back to `obsidian://open?file=…`, which opens in the active
   *  vault. Not the CouchDB database name. */
  vaultName: string;
  caseSensitive: boolean; // LiveSync "Handle files as Case-Sensitive" (default off)
  hashAlgorithm: 'sha1' | 'xxhash'; // must match the user's LiveSync chunk hash
  // Cloud LLM / embedder (used by later tickets)
  llmProvider: string;
  llmModel: string;
  llmApiKey: string;
  embedderModel: string;
  /** The app-owned CouchDB database holding cached embeddings — a sibling of the vault
   *  database, never the vault itself (ADR-0004). */
  embeddingsDb: string;
}

export const DEFAULT_SETTINGS: Settings = {
  couchdbUrl: '',
  couchdbDb: '',
  couchdbUser: '',
  couchdbPassword: '',
  managedFolder: 'Brain Dump',
  dumpsFolder: '_dumps',
  vaultName: '',
  caseSensitive: false,
  hashAlgorithm: 'sha1',
  // Real defaults, not suggestions. A greyed placeholder that looks like a default but
  // is not one cost a dogfooding session: the fields read as pre-filled, were actually
  // empty, and every LLM call resolved against the app's own origin. The values below are
  // the pair verified live by the Seam C smoke test; the API key is the only cloud field
  // that cannot have a default.
  llmProvider: 'https://openrouter.ai/api/v1',
  llmModel: 'deepseek/deepseek-v4-flash',
  llmApiKey: '',
  embedderModel: 'openai/text-embedding-3-small',
  embeddingsDb: 'brain-dump-embeddings',
};
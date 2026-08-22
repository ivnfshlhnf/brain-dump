// "Test connection" — the external dependencies, checked independently.
//
// Every failure the app has hit in real use has been a configuration failure, and each
// one was discovered the same way: by losing a capture into the outbox and reading a
// stack trace. These checks move that discovery to the Config screen, before a thought
// is at stake.
//
// The results are deliberately independent. "Config failed" sends the user back to
// guessing; "CouchDB ✓ / chat ✗ / embeddings ✓" points at one field. So each check runs
// even if an earlier one failed, and each reports its own message.
//
// The chat and embedding checks spend real provider credit — a trivial amount, but the
// UI says so, because a button that quietly costs money is a bad button.
//
// A fourth check runs when a DatabaseAdmin is supplied: whether the CouchDB account may
// create a database, which decides whether the embedding cache can use a sibling database
// (ADR-0004) or must fall back to per-device storage.
import type { DocStore, Embedder, Organizer, Settings } from './types';
import type { DatabaseAdmin } from './db';
import { noopLog, type Log } from './logger';

export interface CheckResult {
  ok: boolean;
  /** What to show the user: what worked, or what to change. */
  message: string;
}

export interface HealthReport {
  couchdb: CheckResult;
  chat: CheckResult;
  embeddings: CheckResult;
  /** Whether the CouchDB account may create a database — omitted when no DatabaseAdmin
   *  is supplied, so existing callers and tests are unaffected. */
  databaseCreation?: CheckResult;
}

export interface HealthDeps {
  db: DocStore;
  organizer: Organizer;
  embedder: Embedder;
  settings: Settings;
  log?: Log;
  /** Supplied by the app; omitted by tests that do not exercise the permission check. */
  admin?: DatabaseAdmin;
}

/** Probe text for the cloud checks — short, so the credit spent is negligible, and
 *  meaningful enough that a model has something real to organize. */
const PROBE = 'A short note about watering the basil.';

/** The throwaway database the permission check creates and then removes. Named so it is
 *  obviously the app's and obviously disposable, in the unlikely event a run is interrupted
 *  between the create and the delete. */
export const PROBE_DATABASE = 'brain-dump-permission-probe';

/** Run every check, always. An earlier failure never short-circuits a later one: knowing
 *  that CouchDB is fine while the embedder is not is the entire point. */
export async function checkConnections(deps: HealthDeps): Promise<HealthReport> {
  const log = deps.log ?? noopLog;
  const report: HealthReport = {
    couchdb: await checkCouchdb(deps),
    chat: await checkChat(deps),
    embeddings: await checkEmbeddings(deps),
  };
  if (deps.admin) report.databaseCreation = await checkDatabaseCreation(deps.admin);
  log({
    level: [report.couchdb, report.chat, report.embeddings, report.databaseCreation].every(
      (c) => c === undefined || c.ok,
    )
      ? 'info'
      : 'error',
    op: 'health',
    message: 'connection test finished',
    detail: {
      couchdb: report.couchdb.ok,
      chat: report.chat.ok,
      embeddings: report.embeddings.ok,
      ...(report.databaseCreation ? { databaseCreation: report.databaseCreation.ok } : {}),
    },
  });
  return report;
}

/** CouchDB reachable and the credentials accepted. `allDocs` with a limit of zero asks
 *  the server to authenticate and answer without reading the vault — a full read would
 *  make "test connection" cost more than the thing it is testing. */
async function checkCouchdb(deps: HealthDeps): Promise<CheckResult> {
  const { couchdbUrl, couchdbDb } = deps.settings;
  if (!couchdbUrl.trim() || !couchdbDb.trim()) {
    return { ok: false, message: 'CouchDB URL and database are required.' };
  }
  try {
    await deps.db.allDocs({ include_docs: false, limit: 0 });
    return { ok: true, message: `Connected to ${couchdbUrl}/${couchdbDb}` };
  } catch (e) {
    return { ok: false, message: `CouchDB: ${describe(e)}` };
  }
}

/** The chat model answers and returns parseable JSON. This exercises the same path
 *  Organize uses, so it also proves the model honours `response_format` — the hard
 *  requirement ADR-0003 puts on model choice. */
async function checkChat(deps: HealthDeps): Promise<CheckResult> {
  if (!deps.settings.llmModel.trim()) {
    return { ok: false, message: 'LLM model is required.' };
  }
  try {
    const out = await deps.organizer.organize(PROBE, 'text');
    if (!out.title) {
      return { ok: false, message: `${deps.settings.llmModel} replied without a title — check the model supports JSON mode.` };
    }
    return { ok: true, message: `${deps.settings.llmModel} replied and returned valid JSON.` };
  } catch (e) {
    return { ok: false, message: `Chat: ${describe(e)}` };
  }
}

/** The embedder returns a usable vector. An empty or zero-length vector would make every
 *  similarity score zero, silently ranking the vault at random — worth catching here. */
async function checkEmbeddings(deps: HealthDeps): Promise<CheckResult> {
  if (!deps.settings.embedderModel.trim()) {
    return { ok: false, message: 'Embedder model is required.' };
  }
  try {
    const [vector] = await deps.embedder.embed([PROBE]);
    if (!vector?.length) {
      return { ok: false, message: `${deps.settings.embedderModel} returned no vector.` };
    }
    return { ok: true, message: `${deps.settings.embedderModel} returned a ${vector.length}-dimension vector.` };
  } catch (e) {
    return { ok: false, message: `Embeddings: ${describe(e)}` };
  }
}

/** An error's message, never the error object — a thrown response could otherwise carry
 *  request headers (and so the API key) into the UI and the diagnostics log. */
function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** May this CouchDB account create a database?
 *
 *  CouchDB 3.x requires server-admin rights to create one, and the configured account is not
 *  necessarily an admin. The answer decides whether the embedding cache can live in a sibling
 *  database (ADR-0004) or must fall back to per-device storage — so it is worth knowing before
 *  that work starts, not during it.
 *
 *  Asking is the only reliable way to find out: roles alone do not determine the answer across
 *  CouchDB configurations. So this creates a throwaway database and removes it again.
 *
 *  SAFETY: it only ever deletes a database it created itself. If the probe name is already
 *  taken, it reports that and deletes nothing — a check that could destroy a real database
 *  would be far worse than an unanswered question.
 */
async function checkDatabaseCreation(admin: DatabaseAdmin): Promise<CheckResult> {
  try {
    if (await admin.exists(PROBE_DATABASE)) {
      return {
        ok: false,
        message: `Could not test: a database named "${PROBE_DATABASE}" already exists. Remove it and test again.`,
      };
    }
  } catch (e) {
    return { ok: false, message: `Database creation: ${describe(e)}` };
  }

  try {
    await admin.create(PROBE_DATABASE);
  } catch (e) {
    return {
      ok: false,
      message: `Cannot create databases (${describe(e)}). The embedding cache will fall back to per-device storage.`,
    };
  }

  try {
    await admin.destroy(PROBE_DATABASE);
  } catch (e) {
    // Creation is what was being tested, and it worked. A failed cleanup is a real problem
    // but a different one, so report the success and name the leftover to remove by hand.
    return {
      ok: true,
      message: `Can create databases, but could not remove the probe "${PROBE_DATABASE}" (${describe(e)}) — remove it by hand.`,
    };
  }

  return { ok: true, message: 'Can create databases — the embedding cache can use a sibling database.' };
}

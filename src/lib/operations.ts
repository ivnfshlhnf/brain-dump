// The operation layer — the seam the UI calls and the unit under test (Seam A).
import type {
  DocStore,
  Dump,
  Modality,
  Note,
  NoteCandidate,
  Organizer,
  Matcher,
  OutboxStore,
  Settings,
} from './types';
import { writeFile, modifyFile, readVaultFiles } from './livesync';
import { noopLog, type Log } from './logger';

/** The `## Context` block appended after the verbatim original, when Context exists. */
function contextBlock(ctx: string): string {
  return `## Context\n\n${ctx}`;
}

/** The full text of a Dump as it should be Organized: the verbatim original plus
 *  any added Context. With no Context, this is just the original (so the initial
 *  Organize sees the bare capture). The final Organize sees original + Context. */
export function dumpText(dump: Dump): string {
  const ctx = dump.context.trim();
  return ctx ? `${dump.content}\n\n${contextBlock(ctx)}` : dump.content;
}

/** The store-side deps every write needs: where to write, how to name it, how to
 *  hash its content. */
export interface StoreDeps {
  db: DocStore;
  settings: Settings;
  hash: (content: string) => Promise<string>;
  /** Optional diagnostics. Defaults to `noopLog`, so no existing caller or test has to
   *  supply one; the app passes a real Log so failures reach `logs/brain-dump.jsonl`. */
  log?: Log;
}

/** The verbatim text of a Capture, rejecting an empty brain-dump. */
function captureText(text: string): string {
  const content = text.trim();
  if (!content) throw new Error('Cannot capture an empty brain-dump.');
  return content;
}

/** The vault-relative path plus the LiveSync doc ids written for one file. */
export interface WriteResult {
  path: string;
  metadataId: string;
  chunkId: string;
}

export interface CaptureDeps {
  db: DocStore;
  settings: Settings;
  now: () => number;
  newId: () => string;
  hash: (content: string) => Promise<string>;
  log?: Log;
}

export interface CaptureResult extends WriteResult {
  dump: Dump;
}

export interface OrganizeDeps {
  db: DocStore;
  settings: Settings;
  organizer: Organizer;
  hash: (content: string) => Promise<string>;
}

export interface OrganizeResult extends WriteResult {
  note: Note;
}

/** Write a file as a metadata doc + content-addressed chunk, ctime/mtime both `time`. */
async function writeAt(
  db: DocStore,
  path: string,
  content: string,
  time: number,
  deps: { hash: (content: string) => Promise<string>; settings: Settings },
): Promise<WriteResult> {
  const { metadataId, chunkId } = await writeFile(db, path, content, {
    ctime: time,
    mtime: time,
    hash: deps.hash,
    settings: deps.settings,
  });
  return { path, metadataId, chunkId };
}

/** Capture a text brain-dump: write a verbatim Dump to _dumps/ in LiveSync format. */
export async function capture(text: string, deps: CaptureDeps): Promise<CaptureResult> {
  const content = captureText(text);

  const createdAt = deps.now();
  const id = deps.newId();
  const dump: Dump = { id, content, context: '', createdAt, modality: 'text' };

  const written = await writeDump(dump, deps);

  return { dump, ...written };
}

/** Write a Dump to the Dumps folder in LiveSync format. Idempotent for a given Dump:
 *  the path is derived from its id and capture time, so re-writing the same Dump
 *  (a Context edit, or a retried outbox sync) rewrites that one file. */
export async function writeDump(dump: Dump, deps: StoreDeps): Promise<WriteResult> {
  const path = `${deps.settings.dumpsFolder}/${dumpFilename(dump.createdAt, dump.id)}`;
  return writeAt(deps.db, path, dumpFileContent(dump), dump.createdAt, deps);
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** <YYYYMMDD>-<HHMMSS>-<shortid>.md — UTC, so filenames are deterministic across machines. */
export function dumpFilename(createdAt: number, id: string): string {
  const d = new Date(createdAt);
  const stamp = `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}-${pad2(
    d.getUTCHours(),
  )}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}`;
  const short = id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6);
  return `${stamp}-${short}.md`;
}

/** Minimal frontmatter + the verbatim original in a `## Original` section, plus a
 *  `## Context` section when Context has been added. The verbatim original is
 *  preserved inside the Dump even as Context edits it. */
export function dumpFileContent(dump: Dump): string {
  const ctx = dump.context.trim();
  const ctxSection = ctx ? `\n\n${contextBlock(ctx)}` : '';
  return `---
id: ${dump.id}
created: ${dump.createdAt}
modality: ${dump.modality}
---

## Original

${dump.content}${ctxSection}
`;
}

/** Organize a Dump into a Note via the cloud LLM. Pure orchestration — produces the
 *  in-memory Note (the preview, or the final Note) without writing it. The initial
 *  Organize runs over the bare original; the final Organize runs over `dumpText(dump)`
 *  (original + Context). */
export async function organizeNote(
  dump: Dump,
  organizer: Organizer,
  settings: Settings,
): Promise<Note> {
  const output = await organizer.organize(dumpText(dump), dump.modality);
  return {
    title: output.title,
    tags: output.tags,
    createdAt: dump.createdAt,
    modality: dump.modality,
    source: sourceWikilink(dump, settings),
    category: output.category,
    summary: output.summary,
    body: output.body,
    keyPoints: output.keyPoints,
    related: output.related,
  };
}

/** Write a Note to the managed folder as a LiveSync metadata doc + chunk doc. */
export async function writeNote(
  note: Note,
  db: DocStore,
  settings: Settings,
  hash: (content: string) => Promise<string>,
): Promise<WriteResult> {
  const path = `${settings.managedFolder}/${noteFilename(note)}`;
  return writeAt(db, path, noteFileContent(note), note.createdAt, { hash, settings });
}

/** Organize a Dump into a Note via the cloud LLM, then write it to the managed folder. */
export async function organizeDump(dump: Dump, deps: OrganizeDeps): Promise<OrganizeResult> {
  const note = await organizeNote(dump, deps.organizer, deps.settings);
  const written = await writeNote(note, deps.db, deps.settings, deps.hash);
  return { note, ...written };
}

/** <YYYY-MM-DD>-<title-slug>.md — UTC date, slugified title. Notes sort chronologically. */
export function noteFilename(note: Pick<Note, 'createdAt' | 'title'>): string {
  const d = new Date(note.createdAt);
  const date = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  return `${date}-${slugify(note.title)}.md`;
}

/** Lowercase, hyphenate, strip non-alphanumerics, trim stray hyphens. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** An Obsidian wikilink to a vault-relative path (the extension is dropped, as
 *  Obsidian links by name). */
export function wikilink(path: string): string {
  return `[[${path.replace(/\.md$/, '')}]]`;
}

/** Obsidian wikilink to the source Dump. */
export function sourceWikilink(dump: Dump, settings: Settings): string {
  return wikilink(`${settings.dumpsFolder}/${dumpFilename(dump.createdAt, dump.id)}`);
}

/** The v1 frontmatter block (the `---`-fenced schema), with the blank-line separator
 *  that precedes the body. Shared by Note creation and the explicit metadata refresh. */
export function noteFrontmatter(
  note: Pick<Note, 'title' | 'tags' | 'createdAt' | 'modality' | 'source' | 'category' | 'summary'>,
): string {
  return `---
title: ${note.title}
tags: [${note.tags.join(', ')}]
created: ${note.createdAt}
modality: ${note.modality}
source: ${note.source}
category: ${note.category}
summary: ${note.summary}
---

`;
}

/** Note file: v1 frontmatter schema + cleaned body + Summary/Key points/Related sections. */
export function noteFileContent(note: Note): string {
  return `${noteFrontmatter(note)}${note.body}

## Summary

${note.summary}

## Key points

${note.keyPoints.map((p) => `- ${p}`).join('\n')}

## Related

${note.related.map((r) => `- ${r}`).join('\n')}
`;
}

// --- Capture review flow (ticket 03) -------------------------------------
// The full `capture(text)` composition (Dump + initial Organize + Note preview +
// new-vs-append match) defined at spec line 60 spans tickets 02+03+04. Ticket 03
// composes the capture→preview→Context→autosave flow. The match decision is
// 'new' here; ticket 04 fills LLM-assisted matching against existing Notes.

/** The new-vs-append decision offered alongside a Note preview. Ticket 03 always
 *  decides 'new'; ticket 04 adds 'append' with the suggested existing Note. */
export interface MatchDecision {
  kind: 'new' | 'append';
  suggestion?: NoteCandidate; // the suggested existing Note when 'append'
}

/** An in-flight capture review session: the captured Dump, the initial Organize
 *  preview (held while Context is added), the match decision, and saved state. */
export interface CaptureSession {
  dump: Dump; // the captured Dump (original + accumulating Context)
  preview: Note; // the initial Organize preview — held, not re-organized per edit
  match: MatchDecision; // new vs append (ticket 04 fills matching)
  saved: boolean; // true once the Note has been written and the Dump frozen
}

/** Deps to begin a capture review session (capture's deps plus the Organizer and Matcher). */
export interface BeginCaptureDeps extends CaptureDeps {
  organizer: Organizer;
  matcher: Matcher;
}

/** Deps to add Context to a session's Dump (rewrite the Dump file). */
export type ContextDeps = StoreDeps;

/** Deps to finalize a session (final Organize + write/append the Note). `now` stamps
 *  the appended section and the file mtime on the append path. */
export interface FinalizeDeps {
  db: DocStore;
  settings: Settings;
  organizer: Organizer;
  hash: (content: string) => Promise<string>;
  now: () => number;
}

/** Begin a capture review session: save the verbatim Dump immediately, run the
 *  initial Organize for the preview, and match it (LLM-assisted, by tags/topic)
 *  against the existing Notes to offer new-vs-append. */
export async function beginCapture(
  text: string,
  deps: BeginCaptureDeps,
): Promise<CaptureSession> {
  const { dump } = await capture(text, deps);
  const preview = await organizeNote(dump, deps.organizer, deps.settings);
  const match = await matchNote(preview, deps.db, deps.settings, deps.matcher);
  return { dump, preview, match, saved: false };
}

/** Add Context to the Dump: rewrites the Dump file preserving the verbatim original
 *  inside a `## Original` section (Context goes in a `## Context` section). The
 *  preview is held — no re-organize per edit. Throws once the session is saved
 *  (the Dump is frozen and immutable thereafter). */
export async function addContext(
  session: CaptureSession,
  context: string,
  deps: ContextDeps,
): Promise<CaptureSession> {
  if (session.saved) throw new Error('Cannot add Context: the Dump is frozen.');

  const ctx = context.trim();
  if (!ctx) return session; // no-op: empty Context does not edit the Dump

  const dump: Dump = { ...session.dump, context: ctx };
  await writeDump(dump, deps);

  return { ...session, dump };
}

export type FinalizeResult =
  | { ok: true; note: Note; session: CaptureSession; written: WriteResult }
  | { ok: false; note: Note; session: CaptureSession; error: Error };

/** Finalize a capture: run the final Organize over the full Dump (original +
 *  Context), then either found a new Note or append a dated section to the matched
 *  existing Note, and freeze the Dump. If the final save fails, the Dump persists
 *  (Context already written) and the Note is generated from it later — the session
 *  stays unsaved so the user can retry. */
export async function finalizeCapture(
  session: CaptureSession,
  deps: FinalizeDeps,
): Promise<FinalizeResult> {
  if (session.saved) throw new Error('Already saved.');

  const note = await organizeNote(session.dump, deps.organizer, deps.settings);
  try {
    const written =
      session.match.kind === 'append' && session.match.suggestion
        ? await appendDumpToNote(note, session.match.suggestion.path, deps)
        : await writeNote(note, deps.db, deps.settings, deps.hash);
    return { ok: true, note, written, session: { ...session, saved: true } };
  } catch (error) {
    return { ok: false, note, error: error as Error, session: { ...session, saved: false } };
  }
}

// --- Append a Dump to an existing Note (ticket 04) -----------------------
// Matching is LLM-assisted (by tags/topic) against the existing Notes in the
// managed folder; embedding-based matching is deferred until Retrieve (06).
// Appending adds a new dated section to the Note body and never overwrites the
// user's edits — writes use optimistic concurrency (write with the current `_rev`;
// on a 409, re-fetch, re-apply the append, retry). Metadata refresh (re-deriving
// title/tags/summary) is explicit and user-triggered, never automatic.

/** The frontmatter fields parsed out of a Note file, in the v1 schema shape. */
export interface ParsedFrontmatter {
  title: string;
  tags: string[];
  summary: string;
  category: string;
  created: number;
  modality: Modality;
  source: string;
}

/** Split a Note file into its frontmatter block, the raw fields, and the body that
 *  follows. The body is returned verbatim (preserving any user edits). */
export function splitFrontmatter(content: string): {
  frontmatter: string;
  body: string;
  fields: Record<string, string>;
} {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { frontmatter: '', body: content, fields: {} };
  const fields: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    fields[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { frontmatter: m[0], body: content.slice(m[0].length), fields };
}

/** Parse the v1 frontmatter out of a Note file. `tags: [a, b]` is split into an
 *  array; everything else is a scalar. Tolerant of a missing frontmatter block. */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  const { fields } = splitFrontmatter(content);
  const tagsRaw = (fields.tags ?? '').trim();
  const tags = tagsRaw
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    title: fields.title ?? '',
    tags,
    summary: fields.summary ?? '',
    category: fields.category ?? '',
    created: Number(fields.created ?? 0),
    modality: fields.modality === 'voice' ? 'voice' : 'text',
    source: fields.source ?? '',
  };
}

/** Read the existing Notes in the managed folder as match candidates — a projection
 *  (path/title/tags/summary) enough to judge tags/topic overlap. The `path`
 *  (original-case, from the metadata doc) identifies the Note for the append.
 *  Each Note's chunk is fetched (a full-vault read, per ADR-0002); the body is
 *  discarded after parsing the frontmatter. */
export async function readNoteCandidates(
  db: DocStore,
  settings: Settings,
): Promise<NoteCandidate[]> {
  const files = await readVaultFiles(db, (path) => path.startsWith(`${settings.managedFolder}/`));
  return files.map((file) => {
    const fm = parseFrontmatter(file.content);
    return { path: file.path, title: fm.title, tags: fm.tags, summary: fm.summary };
  });
}

/** Match a new Dump's preview against the existing Notes: LLM-assisted, by
 *  tags/topic. With no existing Notes the decision is 'new' (no matcher call).
 *  A suggestion whose path is no longer a known candidate falls back to 'new'. */
export async function matchNote(
  preview: Note,
  db: DocStore,
  settings: Settings,
  matcher: Matcher,
): Promise<MatchDecision> {
  const candidates = await readNoteCandidates(db, settings);
  if (candidates.length === 0) return { kind: 'new' };
  const suggestion = await matcher.match(
    { title: preview.title, tags: preview.tags, summary: preview.summary },
    candidates,
  );
  if (suggestion.kind === 'new') return { kind: 'new' };
  const candidate = candidates.find((c) => c.path === suggestion.path);
  return candidate ? { kind: 'append', suggestion: candidate } : { kind: 'new' };
}

/** `<YYYY-MM-DD> <HH:MM:SS> UTC` — the stamp on an appended section (UTC, like the
 *  filenames, so it is deterministic across machines). */
function formatStamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(
    d.getUTCHours(),
  )}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} UTC`;
}

/** A new dated section for the Note body: a timestamped heading, the organized
 *  body of the appended Dump, and a traceability link back to the source Dump.
 *
 *  The stamp is the Dump's capture time (`note.createdAt`), not the moment of the
 *  append: the section *is* the Dump, so it is dated by when the thought occurred —
 *  the meaningful date for a journal-style entry. The append action's time is
 *  recorded as the file's `mtime` instead. */
export function datedSection(note: Note): string {
  return `## Appended ${formatStamp(note.createdAt)}\n\n${note.body.trim()}\n\n_Source: ${note.source}_`;
}

export interface AppendDeps {
  db: DocStore;
  settings: Settings;
  hash: (content: string) => Promise<string>;
  now: () => number;
}

/** Append a Dump's organized content to an existing Note as a new dated section.
 *  Optimistic concurrency: writes with the current `_rev`; on a 409, re-fetches the
 *  fresh Note content and re-applies the append, so a concurrent edit survives. The
 *  frontmatter (title/tags/summary) is untouched — metadata refresh is explicit. */
export async function appendDumpToNote(
  note: Note,
  notePath: string,
  deps: AppendDeps,
): Promise<WriteResult> {
  const section = datedSection(note);
  const { metadataId, chunkId } = await modifyFile(
    deps.db,
    notePath,
    (current) => `${current.trimEnd()}\n\n${section}\n`,
    { mtime: deps.now(), hash: deps.hash, settings: deps.settings },
  );
  return { path: notePath, metadataId, chunkId };
}

export interface RefreshDeps {
  db: DocStore;
  settings: Settings;
  organizer: Organizer;
  hash: (content: string) => Promise<string>;
  now: () => number;
}

/** Explicit, user-triggered metadata refresh: re-organize the Note's full body and
 *  re-derive the frontmatter (title/tags/category/summary) from it, preserving the
 *  body byte-for-byte. Never called automatically — the append never refreshes.
 *
 *  The Organize runs once per user action: the re-derived frontmatter is computed on
 *  the first attempt and cached, then re-applied to the (possibly fresher) body on
 *  each 409 retry. A concurrent body edit therefore survives (the body is preserved);
 *  only the derived metadata may be one revision stale, which is acceptable for an
 *  explicit, best-effort refresh. */
export async function refreshNoteMetadata(
  notePath: string,
  deps: RefreshDeps,
): Promise<WriteResult> {
  let frontmatter: string | null = null; // re-derived once, reused across 409 retries
  const { metadataId, chunkId } = await modifyFile(
    deps.db,
    notePath,
    async (current) => {
      if (frontmatter === null) {
        const fm = parseFrontmatter(current);
        const { body } = splitFrontmatter(current);
        const out = await deps.organizer.organize(body, fm.modality);
        frontmatter = noteFrontmatter({
          title: out.title,
          tags: out.tags,
          createdAt: fm.created,
          modality: fm.modality,
          source: fm.source,
          category: out.category,
          summary: out.summary,
        });
      }
      // Re-apply the once-derived frontmatter to the freshest body (preserved verbatim).
      const { body } = splitFrontmatter(current);
      return `${frontmatter}${body}`;
    },
    { mtime: deps.now(), hash: deps.hash, settings: deps.settings },
  );
  return { path: notePath, metadataId, chunkId };
}

// --- Offline outbox (ticket 05) ------------------------------------------
// Organize is an online-time step: a Capture with no connection cannot produce a
// preview, so the Dump is queued in the IndexedDB outbox and the user is told it is
// saved and will be Organized on reconnect. On reconnect the queued Dumps sync to
// CouchDB and are Organized into Notes without the user's involvement.
//
// Because an unattended drain has nobody to confirm an append with (the one-tap
// new-vs-append confirm from ticket 04), a drained Dump always founds a new Note.

/** What the user is told when a Capture is queued with no connection. */
export const OFFLINE_CAPTURE_MESSAGE = 'saved, will organize when online';

/** What the user is told when a Capture that started online failed and fell back to
 *  the outbox. The user is not offline, so saying so would be a lie — the honest
 *  promise is a retry. */
export const CAPTURE_RETRY_MESSAGE = 'saved, will organize on the next retry';

/** Why a Capture ended up in the outbox: there was no connection, or the online
 *  attempt failed mid-flight. The distinction is the user's to see — it is the
 *  difference between "you're offline" and "something went wrong". */
export type QueuedReason = 'offline' | 'capture-failed';

/** The result of a Capture that may have been offline: either a normal review
 *  session (online — preview + match) or a queued Dump (no preview). */
export type CaptureOutcome =
  | { kind: 'session'; session: CaptureSession }
  | { kind: 'queued'; dump: Dump; reason: QueuedReason; message: string; error?: Error };

export interface OfflineCaptureDeps extends BeginCaptureDeps {
  outbox: OutboxStore;
  isOnline: () => boolean;
}

/** Capture a thought whether or not there is a connection.
 *
 *  Online, this is the normal review flow (`beginCapture`): Dump saved, initial
 *  Organize, preview, new-vs-append match. Offline, the Dump is queued in the outbox
 *  and no preview is produced.
 *
 *  The Dump is never lost: if the capture fails *after* `isOnline()` said yes (the
 *  connection dropped, the LLM is down, the credentials are wrong), it falls back to
 *  the outbox rather than surfacing an error with nothing saved. That outcome is
 *  reported as `capture-failed`, not `offline`, and carries the underlying error —
 *  the caller must not tell an online user they are offline. The queued Dump keeps
 *  the id and capture time the failed attempt used, so a later drain rewrites that
 *  same Dump file rather than creating a second one. */
export async function captureOrQueue(
  text: string,
  deps: OfflineCaptureDeps,
): Promise<CaptureOutcome> {
  const content = captureText(text);
  const dump: Dump = {
    id: deps.newId(),
    content,
    context: '',
    createdAt: deps.now(),
    modality: 'text',
  };

  const log = deps.log ?? noopLog;
  log({ op: 'capture', message: 'capture started', detail: { dumpId: dump.id, chars: content.length } });

  if (!deps.isOnline()) {
    await deps.outbox.add(dump);
    log({ op: 'capture', message: 'queued (offline)', detail: { dumpId: dump.id } });
    return { kind: 'queued', dump, reason: 'offline', message: OFFLINE_CAPTURE_MESSAGE };
  }

  // Pin the id and time the queued Dump already holds, so a fallback and its later
  // drain address the same Dump file.
  const pinned: BeginCaptureDeps = { ...deps, now: () => dump.createdAt, newId: () => dump.id };
  try {
    const session = { kind: 'session' as const, session: await beginCapture(content, pinned) };
    log({ op: 'capture', message: 'capture session ready', detail: { dumpId: dump.id } });
    return session;
  } catch (error) {
    await deps.outbox.add(dump);
    // The Dump is safe in the outbox; what the user needs to know is *why* the online
    // path failed, which is almost always the cloud seam or the CouchDB connection.
    log({
      level: 'error',
      op: 'capture',
      message: 'capture failed online — Dump queued for retry',
      detail: { dumpId: dump.id, error: (error as Error).message },
    });
    return {
      kind: 'queued',
      dump,
      reason: 'capture-failed',
      message: CAPTURE_RETRY_MESSAGE,
      error: error as Error,
    };
  }
}

/** One queued Dump that reached the vault as a Note. */
export interface DrainedDump {
  dump: Dump;
  note: Note;
  dumpWrite: WriteResult;
  noteWrite: WriteResult;
}

export interface DrainResult {
  organized: DrainedDump[];
  failed: Array<{ dump: Dump; error: Error }>;
}

export interface DrainDeps extends StoreDeps {
  organizer: Organizer;
  outbox: OutboxStore;
  isOnline: () => boolean;
}

/** Drain the outbox on reconnect: sync each queued Dump to CouchDB and Organize it
 *  into a Note, oldest capture first. A Dump is removed from the outbox only once its
 *  Note has been written, so a failure mid-drain (the LLM is down, the connection
 *  drops again) leaves it queued for the next attempt — it is never lost. Both steps
 *  are idempotent for a given Dump: it is written at a path derived from its id and
 *  capture time, so a retry rewrites the same file. */
export async function drainOutbox(deps: DrainDeps): Promise<DrainResult> {
  const result: DrainResult = { organized: [], failed: [] };
  const log = deps.log ?? noopLog;
  if (!deps.isOnline()) {
    log({ op: 'drain', message: 'skipped — offline' });
    return result;
  }

  const queued = await deps.outbox.list();
  log({ op: 'drain', message: 'drain started', detail: { queued: queued.length } });

  for (const dump of queued) {
    try {
      const dumpWrite = await writeDump(dump, deps);
      log({ op: 'drain', message: 'Dump written', detail: { dumpId: dump.id, path: dumpWrite.path } });
      const note = await organizeNote(dump, deps.organizer, deps.settings);
      const noteWrite = await writeNote(note, deps.db, deps.settings, deps.hash);
      await deps.outbox.remove(dump.id);
      log({
        op: 'drain',
        message: 'Note written, Dump dequeued',
        detail: { dumpId: dump.id, path: noteWrite.path, title: note.title },
      });
      result.organized.push({ dump, note, dumpWrite, noteWrite });
    } catch (error) {
      // Stays queued deliberately — the next drain retries it. Logged every attempt so a
      // repeating failure is visible as a repeating line rather than a silent spin.
      log({
        level: 'error',
        op: 'drain',
        message: 'Dump stayed queued',
        detail: { dumpId: dump.id, error: (error as Error).message },
      });
      result.failed.push({ dump, error: error as Error });
    }
  }
  log({
    op: 'drain',
    message: 'drain finished',
    detail: { organized: result.organized.length, failed: result.failed.length },
  });
  return result;
}

// The operation layer — the seam the UI calls and the unit under test (Seam A).
import type {
  DocStore,
  Dump,
  Embedder,
  Relater,
  Modality,
  Note,
  NoteCandidate,
  Organizer,
  Matcher,
  PendingDump,
  PendingStore,
  Settings,
} from './types';
import { writeFile, modifyFile, readVaultFiles } from './livesync';
import { noopLog, type Log } from './logger';
import { findRelated, type RelatedDeps } from './related';

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
 *  (a Context edit, or a retried recovery) rewrites that one file. */
export async function writeDump(dump: Dump, deps: StoreDeps): Promise<WriteResult> {
  return writeAt(deps.db, dumpPath(dump, deps.settings), dumpFileContent(dump), dump.createdAt, deps);
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

/** The vault-relative path a Dump is written to. Derived from its id and capture time, so
 *  it is the same path on every device and on every rewrite of the same Dump. */
export function dumpPath(dump: Dump, settings: Settings): string {
  return `${settings.dumpsFolder}/${dumpFilename(dump.createdAt, dump.id)}`;
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
  return wikilink(dumpPath(dump, settings));
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
export interface ContextDeps extends StoreDeps {
  /** Kept in step with the Dump, so a recovery started after the app dies Organizes the
   *  thought the user actually finished writing, not the one they started. */
  pending?: PendingStore;
}

/** Deps to finalize a session (final Organize + write/append the Note). `now` stamps
 *  the appended section and the file mtime on the append path. */
export interface FinalizeDeps {
  db: DocStore;
  settings: Settings;
  organizer: Organizer;
  hash: (content: string) => Promise<string>;
  now: () => number;
  log?: Log;
  /** Supplied together to populate the Note's Related links. Omit both and the Note is written
   *  with no Related links — which is what every caller did before related-notes ticket 02, so
   *  existing tests are unaffected. */
  embedder?: Embedder;
  relater?: Relater;
  /** The Dump stops being Pending here, and only here: the Note now exists. */
  pending?: PendingStore;
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
  const record = await deps.pending?.get(dump.id);
  if (record) await deps.pending?.save({ ...record, dump });

  return { ...session, dump };
}

export type FinalizeResult =
  | { ok: true; note: Note; session: CaptureSession; written: WriteResult }
  | { ok: false; note: Note; session: CaptureSession; error: Error };

/** Finalize a capture: settle the Note, then either found a new Note or append a dated
 *  section to the matched existing Note, and freeze the Dump.
 *
 *  The final Organize runs over the full Dump (original + Context) **only when Context was
 *  added**. With no Context the Dump never changed, so the held preview already is the
 *  Organize of the full Dump and is reused — the Note the user approved is the Note that
 *  gets saved. Running it unconditionally meant every plain capture paid for a second LLM
 *  call whose only possible effect was to disagree with the first.
 *
 *  If the final save fails, the Dump persists (Context already written) and the Note is
 *  generated from it later — the session stays unsaved so the user can retry. */
export async function finalizeCapture(
  session: CaptureSession,
  deps: FinalizeDeps,
): Promise<FinalizeResult> {
  if (session.saved) throw new Error('Already saved.');

  // Re-organize only when Context edited the Dump; otherwise the preview already is the
  // Organize of the unchanged Dump. See the docstring for why.
  const organized = session.dump.context
    ? await organizeNote(session.dump, deps.organizer, deps.settings)
    : session.preview;
  // Related is resolved here, at save, and never at capture: it ranks the whole vault, and the
  // capture path exists to feel instant. By now the Dump is complete (original plus any
  // Context), so the links reflect the finished thought rather than the first draft.
  const note = await withRelated(organized, session, deps);
  try {
    const written =
      session.match.kind === 'append' && session.match.suggestion
        ? await appendDumpToNote(note, session.match.suggestion.path, deps)
        : await writeNote(note, deps.db, deps.settings, deps.hash);
    // The Note exists, so the Dump is no longer Pending. If this dequeue is the thing
    // that fails, recovery's already-cited check dequeues it later without a second Note.
    await deps.pending?.remove(session.dump.id);
    return { ok: true, note, written, session: { ...session, saved: true } };
  } catch (error) {
    // The Dump stays Pending, and this counts as an attempt like any other: it is the one
    // failure the user is actually watching, so it must back off and be retried on the
    // timer rather than sit at `in-flight` waiting for a restart to notice it. The open
    // session is excluded from recovery, so the retry cannot race the user's own save.
    const record = await deps.pending?.get(session.dump.id);
    if (record) await recordFailure(record, error as Error, deps.pending!, deps.now());
    return { ok: false, note, error: error as Error, session: { ...session, saved: false } };
  }
}

/** The Note with its Related links filled in, or unchanged when the caller supplied no
 *  embedder and judge.
 *
 *  A failure to resolve Related must never cost the user the Note: the whole step is best
 *  effort, and on any error the Note is written exactly as Organize produced it. */
async function withRelated(
  note: Note,
  session: CaptureSession,
  deps: FinalizeDeps,
): Promise<Note> {
  if (!deps.embedder || !deps.relater) return note;

  // On the Append path the Note being written already exists in the vault; excluding it keeps
  // it from ranking as its own closest match.
  const target =
    session.match.kind === 'append' && session.match.suggestion
      ? session.match.suggestion.path
      : `${deps.settings.managedFolder}/${noteFilename(note)}`;

  const relatedDeps: RelatedDeps = {
    db: deps.db,
    settings: deps.settings,
    embedder: deps.embedder,
    relater: deps.relater,
    log: deps.log,
  };

  try {
    return { ...note, related: await findRelated(note, target, relatedDeps) };
  } catch (error) {
    (deps.log ?? noopLog)({
      level: 'error',
      op: 'related',
      message: 'could not resolve Related links — saving the Note without them',
      detail: { error: (error as Error).message },
    });
    return note;
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


// --- Pending Dumps and recovery (ticket 05; dogfooding finding 02) --------
// Every Dump enrols in the Pending store the moment it is Captured and leaves only
// once its Note exists. Before this, the only Dump the app durably remembered was one
// it had *failed* to Organize — a capture interrupted mid-flight (the tab backgrounded
// on a phone, the app closed during the 5s autosave) left no record at all, so the
// thought sat in the Vault forever with nothing knowing it was never filed. Four Dumps
// were lost that way before anyone noticed; see `.scratch/dogfooding/findings.md` 02.
//
// The store is durability only. Everything below — when a Dump is due, how long to back
// off, when to stop retrying and call it Stranded — is the policy, kept in one place.
//
// Because an unattended recovery has nobody to confirm an append with (the one-tap
// new-vs-append confirm from ticket 04), a recovered Dump always founds a new Note.
// The accepted loss: a Dump that was showing an Append suggestion when the app died comes
// back as a *separate* Note instead of a section in the Note it belonged with. Related is
// what reconnects the two — Append and Related are the same judgment at two thresholds
// (CONTEXT.md) — and a stray Note is recoverable where a stalled thought is not.

/** What the user is told when a Capture is made with no connection. */
export const OFFLINE_CAPTURE_MESSAGE = "saved, will organize when you're back online";

/** What the user is told when a Capture that started online failed and fell back to
 *  the Pending store. The user is not offline, so saying so would be a lie — the honest
 *  promise is a retry. */
export const CAPTURE_RETRY_MESSAGE = 'saved, will organize on the next retry';

/** How long to wait before each successive retry of a failed Organize. Escalating,
 *  because the failures worth retrying fast (a flaky connection) resolve fast, and the
 *  ones that do not (a wrong API key, a broken adapter) should not cost an LLM call a
 *  minute for the rest of the day. */
export const RETRY_BACKOFF_MS = [60_000, 120_000, 300_000, 900_000];

/** After this many failed attempts the app stops retrying and the Dump becomes
 *  Stranded (CONTEXT.md): surfaced with its error, waiting for the user. Retrying
 *  forever against a permanently broken configuration is both expensive and dishonest —
 *  the banner would claim progress that is not happening. */
export const MAX_ORGANIZE_ATTEMPTS = 5;

/** Why a Capture produced no preview: there was no connection, or the online attempt
 *  failed mid-flight. The distinction is the user's to see — it is the difference between
 *  "you're offline" and "something went wrong". */
export type NoPreviewReason = 'offline' | 'capture-failed';

/** The result of a Capture: either a normal review session (online — preview + match) or
 *  a Pending Dump with no preview. Both leave the Dump Pending; only one of them opens a
 *  review. */
export type CaptureOutcome =
  | { kind: 'session'; session: CaptureSession }
  | { kind: 'pending'; dump: Dump; reason: NoPreviewReason; message: string; error?: Error };

export interface PendingCaptureDeps extends BeginCaptureDeps {
  pending: PendingStore;
  isOnline: () => boolean;
  /** Called the instant the Dump is durably Pending — before the Organize is even
   *  attempted. The UI clears its draft here: from this moment the thought is the app's
   *  responsibility, and leaving the text in the box invites the user to press Capture
   *  again, which is exactly how three identical Dumps reached the Vault in finding 02. */
  onPending?: (dump: Dump) => void;
}

/** Capture a thought whether or not there is a connection.
 *
 *  The Dump enrols as Pending *first*, before anything can fail: online or offline,
 *  succeeding or not. That ordering is the whole fix. Enrolling only in the failure
 *  branches — as this did — records nothing when the failure is an interruption, because
 *  an interruption is not an error: the fetch never settles, so no catch ever runs.
 *
 *  Online, this is the normal review flow (`beginCapture`): Dump saved, initial Organize,
 *  preview, new-vs-append match. The record stays Pending until the Note is written
 *  (`finalizeCapture`). Offline, the Dump waits for a connection and no preview is
 *  produced. The record keeps the id and capture time the attempt used, so a later
 *  recovery rewrites that same Dump file rather than creating a second one. */
export async function captureThought(
  text: string,
  deps: PendingCaptureDeps,
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

  const online = deps.isOnline();
  await deps.pending.save({
    dump,
    reason: online ? 'in-flight' : 'offline',
    enrolledAt: dump.createdAt,
    attempts: 0,
  });
  log({ op: 'pending', message: 'Dump enrolled as Pending', detail: { dumpId: dump.id, reason: online ? 'in-flight' : 'offline' } });
  deps.onPending?.(dump);

  if (!online) {
    return { kind: 'pending', dump, reason: 'offline', message: OFFLINE_CAPTURE_MESSAGE };
  }

  // Pin the id and time the Pending record already holds, so the attempt and its later
  // recovery address the same Dump file.
  const pinned: BeginCaptureDeps = { ...deps, now: () => dump.createdAt, newId: () => dump.id };
  try {
    const session = { kind: 'session' as const, session: await beginCapture(content, pinned) };
    log({ op: 'capture', message: 'capture session ready', detail: { dumpId: dump.id } });
    return session;
  } catch (error) {
    await recordFailure(
      { dump, reason: 'in-flight', enrolledAt: dump.createdAt, attempts: 0 },
      error as Error,
      deps.pending,
      dump.createdAt,
    );
    // The Dump is safe in the Pending store; what the user needs to know is *why* the
    // online path failed, which is almost always the cloud seam or the CouchDB connection.
    log({
      level: 'error',
      op: 'capture',
      message: 'capture failed online — Dump left Pending for retry',
      detail: { dumpId: dump.id, error: (error as Error).message },
    });
    return {
      kind: 'pending',
      dump,
      reason: 'capture-failed',
      message: CAPTURE_RETRY_MESSAGE,
      error: error as Error,
    };
  }
}

/** Count a failed Organize attempt against a Dump: keep the error, and set when the next
 *  attempt is due. Shared by the three places an attempt can fail — the Capture, the save
 *  the user is watching, and the unattended recovery — so a Dump backs off the same way
 *  whichever one hit the wall. */
async function recordFailure(
  record: PendingDump,
  error: Error,
  pending: PendingStore,
  now: number,
): Promise<PendingDump> {
  const attempts = record.attempts + 1;
  const next: PendingDump = {
    ...record,
    reason: 'failed',
    attempts,
    lastError: error.message,
    nextAttemptAt: now + RETRY_BACKOFF_MS[Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1)],
  };
  await pending.save(next);
  return next;
}

/** A Pending Dump the app has stopped working on: the attempts ran out. The other
 *  Stranded case — a Dump the Pending store never knew about, because it was captured
 *  before this existed or on another device — is found by `findStrandedDumps`. */
export function isStranded(record: PendingDump): boolean {
  return record.attempts >= MAX_ORGANIZE_ATTEMPTS;
}

/** Whether a record should be attempted now: still being worked on by this session,
 *  out of attempts, or backing off all mean no. */
function isDue(record: PendingDump, now: number): boolean {
  if (record.reason === 'in-flight') return false;
  if (isStranded(record)) return false;
  return (record.nextAttemptAt ?? 0) <= now;
}

/** Adopt the records left `in-flight` by a session that ended. Nothing survived the
 *  restart that could still be organizing them, so the label is a leftover claim: they
 *  are `interrupted`, which makes them due for recovery.
 *
 *  Call this once at start, before recovering — never on the retry timer, which runs
 *  while a capture may genuinely be in flight. (Two tabs open at once would have the
 *  second adopt the first's live capture; brain-dump is a single-tab personal app, and
 *  the cost is one redundant Organize, not a lost thought.) */
export async function adoptInterrupted(
  pending: PendingStore,
  log: Log = noopLog,
): Promise<PendingDump[]> {
  const adopted: PendingDump[] = [];
  for (const record of await pending.list()) {
    if (record.reason !== 'in-flight') continue;
    const next: PendingDump = { ...record, reason: 'interrupted' };
    await pending.save(next);
    adopted.push(next);
    log({
      op: 'pending',
      message: 'Dump was interrupted mid-Organize — due for recovery',
      detail: { dumpId: record.dump.id, enrolledAt: record.enrolledAt },
    });
  }
  return adopted;
}

/** One Pending Dump that reached the Vault as a Note. */
export interface RecoveredDump {
  dump: Dump;
  note: Note;
  dumpWrite: WriteResult;
  noteWrite: WriteResult;
}

export interface RecoveryResult {
  organized: RecoveredDump[];
  failed: Array<{ dump: Dump; error: Error }>;
  /** No longer Pending, and never Organized twice: a Note in the Vault already cites them. */
  alreadyOrganized: Dump[];
  /** Out of attempts — Stranded, no longer retried, waiting for the user. */
  stranded: PendingDump[];
}

export interface RecoverDeps extends StoreDeps {
  organizer: Organizer;
  pending: PendingStore;
  isOnline: () => boolean;
  now: () => number;
  /** Dump ids the user is reviewing on screen right now. Their Notes are about to be
   *  written by the session itself, so recovering them would race it into a second Note. */
  exclude?: string[];
}

/** Recover every Pending Dump that is due: sync it to CouchDB and Organize it into a
 *  Note, oldest capture first. Runs at start (for whatever the last session left behind),
 *  on reconnect, and on the retry timer.
 *
 *  A Dump leaves the Pending store only once its Note has been written, so a failure
 *  mid-recovery leaves it Pending for the next attempt — it is never lost. Two guards
 *  keep a retry from producing a second Note for the same thought:
 *
 *  - A Dump already cited by a Note in the Vault stops being Pending untouched. That closes the
 *    window between writing the Note and dequeuing (the Note filename is derived from the
 *    LLM's title, so a second Organize would land in a *different* file, not overwrite the
 *    first), and it means a Dump organized on the phone is not organized again on the laptop.
 *  - The Dump is re-read from the Vault when it is already there, so any Context the user
 *    added survives a recovery that the Pending record's snapshot predates. */
export async function recoverPending(deps: RecoverDeps): Promise<RecoveryResult> {
  const result: RecoveryResult = { organized: [], failed: [], alreadyOrganized: [], stranded: [] };
  const log = deps.log ?? noopLog;
  if (!deps.isOnline()) {
    log({ op: 'recover', message: 'skipped — offline' });
    return result;
  }

  const now = deps.now();
  const exclude = new Set(deps.exclude ?? []);
  const due = (await deps.pending.list()).filter((r) => isDue(r, now) && !exclude.has(r.dump.id));
  log({ op: 'recover', message: 'recovery started', detail: { due: due.length } });

  // One Vault read for the whole run, and only when there is something to recover.
  const vault = due.length ? await readVaultState(deps) : { dumps: new Map(), referenced: new Set() };

  for (const record of due) {
    const path = dumpPath(record.dump, deps.settings);
    try {
      if (vault.referenced.has(wikilink(path))) {
        await deps.pending.remove(record.dump.id);
        result.alreadyOrganized.push(record.dump);
        log({
          op: 'recover',
          message: 'a Note already cites this Dump — no longer Pending, not re-Organized',
          detail: { dumpId: record.dump.id, path },
        });
        continue;
      }

      // The Vault's copy wins where it exists: `addContext` writes the Dump file before it
      // updates the record, so a death between those two leaves the Context only in the
      // Vault. Consequence worth knowing: this makes the Vault authoritative for the
      // thought, so a Dump file edited by hand in Obsidian is what gets Organized here.
      const dump = vault.dumps.get(path) ?? record.dump;
      const dumpWrite = await writeDump(dump, deps);
      const note = await organizeNote(dump, deps.organizer, deps.settings);
      const noteWrite = await writeNote(note, deps.db, deps.settings, deps.hash);
      await deps.pending.remove(dump.id);
      log({
        op: 'recover',
        message: 'Note written, Dump no longer Pending',
        detail: { dumpId: dump.id, path: noteWrite.path, title: note.title },
      });
      result.organized.push({ dump, note, dumpWrite, noteWrite });
    } catch (error) {
      const failed = await recordFailure(record, error as Error, deps.pending, now);
      log({
        level: 'error',
        op: 'recover',
        message: isStranded(failed)
          ? 'Dump is Stranded — out of attempts, no longer retried'
          : 'Dump stayed Pending — will retry',
        detail: { dumpId: record.dump.id, attempts: failed.attempts, error: failed.lastError },
      });
      result.failed.push({ dump: record.dump, error: error as Error });
    }
  }

  result.stranded = (await deps.pending.list()).filter(isStranded);
  log({
    op: 'recover',
    message: 'recovery finished',
    detail: {
      organized: result.organized.length,
      failed: result.failed.length,
      alreadyOrganized: result.alreadyOrganized.length,
      stranded: result.stranded.length,
    },
  });
  return result;
}

/** Arm a Stranded Dump for another attempt: the attempt count and backoff are cleared, so
 *  the next recovery picks it up. The user asking to retry is new information — they have
 *  usually just fixed the thing that was broken.
 *
 *  With no `ids` this is the Retry offered beside the Stranded line, so it arms **only the
 *  Stranded** Dumps. A Dump that is merely backing off is not Stranded and is already going
 *  to be retried; clearing its wait would put a broken provider straight back into a spin.
 *  Naming a Dump explicitly arms it either way — that is a deliberate ask, not a blanket. */
export async function retryPending(pending: PendingStore, ids?: string[]): Promise<void> {
  const wanted = ids ? new Set(ids) : null;
  for (const record of await pending.list()) {
    if (wanted ? !wanted.has(record.dump.id) : !isStranded(record)) continue;
    await pending.save({ ...record, attempts: 0, nextAttemptAt: undefined });
  }
}

// --- Vault reconciliation ------------------------------------------------
// The Pending store only knows about this device, since the day it shipped. The Vault
// knows about every Dump ever captured — so the Vault is what you ask when you want the
// truth. Deliberately manual (a Config action): a scan that Organizes on its own would,
// on its first run, spend LLM calls on thoughts the user may have abandoned months ago.

/** Every Dump a Note cites, as wikilinks — from a Note's `source:` frontmatter and from
 *  the `_Source:` line of each appended dated section. Both forms matter: an Appended
 *  Dump founded no Note of its own, and is filed exactly as thoroughly. */
export function referencedDumpLinks(files: Array<{ content: string }>): Set<string> {
  const links = new Set<string>();
  for (const file of files) {
    for (const match of file.content.matchAll(/^_?[Ss]ource:\s*(\[\[[^\]\n]+\]\])/gm)) {
      links.add(match[1]);
    }
  }
  return links;
}

/** Parse a Dump back out of its file — the inverse of `dumpFileContent`. Returns null
 *  for a file that is not a Dump (no id in the frontmatter), so a stray file in the
 *  Dumps folder is skipped rather than half-read. */
export function parseDumpFile(content: string): Dump | null {
  const { fields, body } = splitFrontmatter(content);
  if (!fields.id) return null;
  const [original = '', context = ''] = body.split(/\n+##\s+Context\s*\n+/);
  return {
    id: fields.id,
    content: original.replace(/^\s*##\s+Original\s*\n+/, '').trim(),
    context: context.trim(),
    createdAt: Number(fields.created ?? 0),
    modality: fields.modality === 'voice' ? 'voice' : 'text',
  };
}

/** One read of both Managed folders: the Dumps that exist, and the Dumps that Notes cite. */
async function readVaultState(
  deps: StoreDeps,
): Promise<{ dumps: Map<string, Dump>; referenced: Set<string> }> {
  const { managedFolder, dumpsFolder } = deps.settings;
  const files = await readVaultFiles(
    deps.db,
    (path) => path.startsWith(`${managedFolder}/`) || path.startsWith(`${dumpsFolder}/`),
  );
  const dumps = new Map<string, Dump>();
  for (const file of files) {
    if (!file.path.startsWith(`${dumpsFolder}/`)) continue;
    const dump = parseDumpFile(file.content);
    if (dump) dumps.set(file.path, dump);
  }
  const referenced = referencedDumpLinks(
    files.filter((f) => f.path.startsWith(`${managedFolder}/`)),
  );
  return { dumps, referenced };
}

export interface ReconcileDeps extends StoreDeps {
  /** Optional. Dumps already in the Pending store are excluded from the result: they are
   *  known, and recovery is about to deal with them. Omit it and every unreferenced Dump in
   *  the Vault is reported, which is what a test asking only about the Vault wants. */
  pending?: PendingStore;
}

/** Every Dump in the Vault that no Note cites — the thoughts the app took and never
 *  filed (CONTEXT.md: Stranded). This is the check from finding 02, run by the app
 *  instead of by hand.
 *
 *  Dumps already in the Pending store are excluded: they are known, and recovery is
 *  about to deal with them. Oldest first. */
export async function findStrandedDumps(deps: ReconcileDeps): Promise<Dump[]> {
  const { dumps, referenced } = await readVaultState(deps);
  const records = deps.pending ? await deps.pending.list() : [];
  const known = new Set(records.map((r) => r.dump.id));
  const stranded: Dump[] = [];
  for (const [path, dump] of dumps) {
    if (referenced.has(wikilink(path)) || known.has(dump.id)) continue;
    stranded.push(dump);
  }
  (deps.log ?? noopLog)({
    op: 'reconcile',
    message: 'Vault reconciled',
    detail: { dumps: dumps.size, referenced: referenced.size, stranded: stranded.length },
  });
  return stranded.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

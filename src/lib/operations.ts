// The operation layer — the seam the UI calls and the unit under test (Seam A).
import type {
  DocStore,
  Dump,
  DumpAppendment,
  Embedder,
  Relater,
  Modality,
  Note,
  NoteCandidate,
  Citation,
  Organizer,
  Matcher,
  DismissedStore,
  NoteCard,
  NoteCardCache,
  PendingDump,
  PendingStore,
  StrandedDump,
  StrandedReason,
  Settings,
} from './types';
import { toCategory, type Category } from './category';
import { writeFile, modifyFile, readVaultFiles, restoreFile, type VaultFile } from './livesync';
import { noopLog, type Log } from './logger';
import { noopStatus, captureConfirmedMessage, type OnStatus } from './status';
import { findRelated, type RelatedDeps } from './related';
import { wikilinkTarget } from './obsidian';

/** The `## Context` block appended after the verbatim original, when Context exists. */
function contextBlock(ctx: string): string {
  return `## Context\n\n${ctx}`;
}

/** The full text of a Dump as it should be Organized: the verbatim original, plus any
 *  added Context, plus every capture Appended into it (ADR-0009 — the Note is organized
 *  from the whole Dump, captures first to last). With none of those, just the original. */
export function dumpText(dump: Dump): string {
  const ctx = dump.context.trim();
  let text = ctx ? `${dump.content}\n\n${contextBlock(ctx)}` : dump.content;
  for (const appends of dump.appended ?? []) {
    text += `\n\n## Appended ${appends.stamp}\n\n${appends.text.trim()}`;
  }
  return text;
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
 *  `## Context` section when Context has been added, plus one `## Appended <stamp>`
 *  section per Appended capture (ADR-0009). Every capture is verbatim inside the Dump.
 *  A Dump whose capture was Appended into another Note's Dump carries the pointer in
 *  its frontmatter instead — filed, not Stranded. */
export function dumpFileContent(dump: Dump): string {
  const ctx = dump.context.trim();
  const ctxSection = ctx ? `\n\n${contextBlock(ctx)}` : '';
  const appended = (dump.appended ?? [])
    .map((a) => `\n\n## Appended ${a.stamp}\n\n${a.text.trim()}`)
    .join('');
  return `---
id: ${dump.id}
created: ${dump.createdAt}
modality: ${dump.modality}${dump.appendedInto ? `\nappendedInto: ${dump.appendedInto}` : ''}
---

## Original

${dump.content}${ctxSection}${appended}
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

/** The new-vs-append decision offered alongside a Note preview. `undecided` is the state
 *  between the preview rendering and the Matcher settling — distinct from `new` on purpose:
 *  reusing `new` as the placeholder is what would make a duplicate-Note save possible, since
 *  nothing could then tell "decided new" from "not decided yet" (capture-latency ticket 03). */
export type MatchDecision =
  | { kind: 'undecided' }
  | { kind: 'new' }
  | { kind: 'append'; suggestion?: NoteCandidate }; // the suggested existing Note when 'append'

/** An in-flight capture review session: the captured Dump, the initial Organize
 *  preview (held while Context is added), the match decision, and saved state. */
export interface CaptureSession {
  dump: Dump; // the captured Dump (original + accumulating Context)
  preview: Note; // the initial Organize preview — held, not re-organized per edit
  match: MatchDecision; // new vs append (ticket 04 fills matching)
  /** The preview's Related pass (capture-latency ticket 04). `resolving` while it runs;
   *  `done` once the links are on the preview — possibly an honest empty, nothing having
   *  cleared the similarity floor; `missed` when the pass failed or missed its deadline,
   *  which renders the same either way. The links live on `preview.related` — the object
   *  the save reuses. */
  related: 'resolving' | 'done' | 'missed';
  saved: boolean; // true once the Note has been written and the Dump frozen
  /** The in-flight pass, resolving to the links or null on failure — never rejects. Started
   *  by `beginCapture` when an embedder and judge are supplied, and deliberately kept after
   *  a deadline miss: a pass that lands before the save is still used. */
  relatedRun?: Promise<string[] | null>;
  /** When the pass started, so the deadline is measured once from there, whoever waits. */
  relatedStartedAt?: number;
}

/** Deps to begin a capture review session (capture's deps plus the Organizer). The Matcher
 *  is resolved later, by `settleMatch` — the preview renders before the match decision. The
 *  embedder and judge are resolved later too, by the preview's own Related pass
 *  (`settleRelated`); omit both and the preview carries no links. */
export interface BeginCaptureDeps extends CaptureDeps {
  organizer: Organizer;
  matcher: Matcher;
  embedder?: Embedder;
  relater?: Relater;
}

/** Deps to settle a session's match decision (the Matcher's dependencies). */
export interface SettleMatchDeps {
  db: DocStore;
  settings: Settings;
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

/** Begin a capture review session: save the verbatim Dump immediately and run the initial
 *  Organize for the preview. The match decision is left `undecided` — the caller settles it
 *  with `settleMatch` while the preview is already on screen (capture-latency ticket 03:
 *  Match decides only new-vs-append, which the sheet expresses in its buttons, so nothing
 *  the user reads waits on it). The preview's Related pass also starts here rather than at
 *  save (ticket 04) — it runs against the preview while the user reads, and `settleRelated`
 *  collects it; omit the embedder and judge and the preview simply carries no links. */
export async function beginCapture(
  text: string,
  deps: BeginCaptureDeps,
): Promise<CaptureSession> {
  const { dump } = await capture(text, deps);
  // The organizer's own `related` output is dropped, as on the append and recovery paths:
  // it has never seen the Vault, so anything it put there is an invented (dead) link. The
  // links that land are only ever the ones the preview's own pass computed.
  const organized = await organizeNote(dump, deps.organizer, deps.settings);
  const preview: Note = { ...organized, related: [] };
  const session: CaptureSession = {
    dump,
    preview,
    match: { kind: 'undecided' },
    related: 'resolving',
    saved: false,
  };
  startPreviewRelated(session, deps);
  return session;
}

/** The Related deadline, measured from when the pass started (capture-latency ticket 04):
 *  past it the sheet stops waiting and the save may file the Note without links. Losing
 *  the links is a far better outcome than losing the Note, and both failures render the
 *  same way ("could not be found just now"). */
export const RELATED_DEADLINE_MS = 5000;

/** A sentinel distinguishing "the pass missed its deadline" from a pass that resolved to
 *  null (failure) — both settle the session to `missed`, but only a real result applies. */
const RELATED_MISSED = Symbol('related missed');

/** Start the preview's Related pass in the background. The run mutates nothing: it resolves
 *  to the links, or null when the pass failed. It never rejects, so a backgrounded failure
 *  costs nothing — `settleRelated` applies whatever it returned. */
function startPreviewRelated(session: CaptureSession, deps: BeginCaptureDeps): void {
  if (!deps.embedder || !deps.relater) {
    session.related = 'done'; // no embedder and judge — the preview carries no links, by design
    return;
  }
  session.relatedStartedAt = Date.now();
  const excludePath = `${deps.settings.managedFolder}/${noteFilename(session.preview)}`;
  const relatedDeps: RelatedDeps = {
    db: deps.db,
    settings: deps.settings,
    embedder: deps.embedder,
    relater: deps.relater,
    log: deps.log,
  };
  session.relatedRun = (async () => {
    try {
      return await findRelated(session.preview, excludePath, relatedDeps);
    } catch (error) {
      (deps.log ?? noopLog)({
        level: 'error',
        op: 'related',
        message: 'preview Related pass failed — the Note will be filed without links',
        detail: { error: (error as Error).message },
      });
      return null;
    }
  })();
}

/** Collect the preview's Related pass, waiting up to the remainder of its deadline
 *  (measured from when the pass started, whoever waits and whenever). On a result the links
 *  land on the session's preview — the object the save reuses — and the session settles to
 *  `done`; on a deadline miss or failure it settles to `missed` and the run stays attached,
 *  so a later `settleRelated` (the sheet's follow-up, which does not wait) applies whatever
 *  landed before the save. With no run at all the session is returned untouched. */
export async function settleRelated(
  session: CaptureSession,
  wait: { timeoutMs?: number } = {},
  log?: Log,
): Promise<CaptureSession> {
  if (!session.relatedRun) return session;
  const remaining =
    wait.timeoutMs ??
    Math.max(0, RELATED_DEADLINE_MS - (Date.now() - (session.relatedStartedAt ?? Date.now())));
  // Node truncates an out-of-range setTimeout delay to 1ms, which would turn "wait
  // indefinitely" into an instant miss — clamp to the 32-bit timer maximum instead.
  const timerMs = Math.min(remaining, 2147483647);
  const result = await Promise.race([
    session.relatedRun,
    new Promise<typeof RELATED_MISSED>((resolve) => setTimeout(() => resolve(RELATED_MISSED), timerMs)),
  ]);
  if (result === RELATED_MISSED) {
    // Logged on the transition only — a settle that finds the miss already recorded (the
    // save's own settle after the sheet's) must not log it twice.
    if (session.related === 'resolving') {
      (log ?? noopLog)({
        level: 'info',
        op: 'related',
        message: 'preview Related pass missed its deadline — the Note will be filed without links unless the pass lands first',
        detail: { waitedMs: remaining },
      });
    }
    return { ...session, related: 'missed' };
  }
  if (result === null) {
    // The pass failed outright — terminal, so the run is dropped; nothing more is coming,
    // and a follow-up settle must not wait on a settled run. Renders the same as a miss.
    return { ...session, related: 'missed', relatedRun: undefined, relatedStartedAt: undefined };
  }
  return {
    ...session,
    preview: { ...session.preview, related: result },
    related: 'done',
    relatedRun: undefined,
    relatedStartedAt: undefined,
  };
}

/** Settle the session's match decision: match the preview against the existing Notes
 *  (LLM-assisted, by tags/topic) to offer new-vs-append. A Match that fails settles to
 *  `new`, matching `matchNote`'s own behaviour for a bad or out-of-range index — a failed
 *  match must not strand the capture. */
export async function settleMatch(
  session: CaptureSession,
  deps: SettleMatchDeps,
): Promise<CaptureSession> {
  try {
    const match = await matchNote(session.preview, deps.db, deps.settings, deps.matcher);
    return { ...session, match };
  } catch {
    return { ...session, match: { kind: 'new' } };
  }
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

/** Finalize a capture: either found a new Note from the Dump, or — when the user confirmed
 *  the Append suggestion — merge the capture into the target Note's Dump and re-organize
 *  that Note wholesale from it (ADR-0009). Either way the Dump freezes on success.
 *
 *  Founding: the final Organize runs over the full Dump (original + Context) **only when
 *  Context was added**. With no Context the Dump never changed, so the held preview already
 *  is the Organize of the full Dump and is reused — the Note the user approved is the Note
 *  that gets saved. Running it unconditionally meant every plain capture paid for a second
 *  LLM call whose only possible effect was to disagree with the first.
 *
 *  Appending: the merge into the target's Dump happens **first** and is the point of
 *  durability — once it lands, the accumulated Dump is the saved source of truth. An
 *  Organize that fails after it leaves the old Note untouched; the user (or recovery)
 *  retries and the Note is re-organized from the Vault, never from memory. The merge is
 *  idempotent — a capture already merged into the target Dump is not merged twice — so a
 *  retry after a mid-flight failure adds no duplicate section.
 *
 *  If the final save fails, the Dump (with the merged capture) persists and the Note is
 *  generated from it later — the session stays unsaved so the user can retry. */
export async function finalizeCapture(
  session: CaptureSession,
  deps: FinalizeDeps,
): Promise<FinalizeResult> {
  if (session.saved) throw new Error('Already saved.');
  if (session.match.kind === 'undecided') {
    // The decision the save exists to honour has not been made. Saving now would found a
    // duplicate Note — the exact failure the Matcher exists to prevent — so the save refuses
    // rather than guessing `new` (capture-latency ticket 03). The autosave timer is armed only
    // once the match has settled, so this is reachable only through an explicit flush racing
    // an unresolved match, which is precisely when the guess would be wrong.
    throw new Error('Cannot save: the new-vs-append decision has not been made yet.');
  }

  try {
    const suggestion =
      session.match.kind === 'append' ? session.match.suggestion : undefined;
    const found = suggestion
      ? await appendCaptureToNote(session, suggestion.path, deps)
      : await foundNewNote(session, deps);
    // The Note exists, so the Dump is no longer Pending. If this dequeue is the thing
    // that fails, recovery's already-cited check dequeues it later without a second Note.
    await deps.pending?.remove(session.dump.id);
    // The settled session — the save may have collected the preview's Related pass on the
    // way through (`foundNewNote`) — is what comes back, not the pre-save session.
    return { ok: true, note: found.note, written: found.written, session: { ...found.session, saved: true } };
  } catch (error) {
    // The Dump stays Pending, and this counts as an attempt like any other: it is the one
    // failure the user is actually watching, so it must back off and be retried on the
    // timer rather than sit at `in-flight` waiting for a restart to notice it. The open
    // session is excluded from recovery, so the retry cannot race the user's own save.
    // The failure is logged here and only here (capture-latency ticket 09) — every other
    // path names its failure in the durable log, and the save must too.
    (deps.log ?? noopLog)({
      level: 'error',
      op: 'save',
      message: 'the save failed — the Dump stays Pending for retry',
      detail: { dumpId: session.dump.id, error: (error as Error).message },
    });
    const record = await deps.pending?.get(session.dump.id);
    if (record) await recordFailure(record, error as Error, deps.pending!, deps.now());
    return {
      ok: false,
      note: session.preview,
      error: error as Error,
      session: { ...session, saved: false },
    };
  }
}

/** Found a new Note: settle the Organize (a fresh call only when Context edited the Dump —
 *  otherwise the held preview already is the Organize of the unchanged Dump; see
 *  `finalizeCapture`), then write. The same shape governs Related (ticket 04): the preview's
 *  links were computed for the preview at capture, so with no Context the save gives the
 *  pass the rest of its deadline and writes the preview as it stands — no second ranking
 *  whose only possible effect was to disagree with the first. With Context the Note changed,
 *  so the links are recomputed at save, as they always were. */
async function foundNewNote(
  session: CaptureSession,
  deps: FinalizeDeps,
): Promise<{ note: Note; written: WriteResult; session: CaptureSession }> {
  if (!session.dump.context) {
    // No Context: the held preview already is the Organize of the unchanged Dump, so the
    // save gives the Related pass the rest of its deadline and writes the preview as it
    // stands — no second ranking whose only possible effect was to disagree with the first.
    const ready = await settleRelated(session, {}, deps.log);
    const written = await writeNote(ready.preview, deps.db, deps.settings, deps.hash);
    return { note: ready.preview, written, session: ready };
  }
  // With Context the Note changed, so the links are recomputed at save, as they always were.
  const organized = await organizeNote(session.dump, deps.organizer, deps.settings);
  const note = await withRelated(organized, session, deps);
  const written = await writeNote(note, deps.db, deps.settings, deps.hash);
  return { note, written, session };
}

/** Read one file from the Vault, matching the bare path or the path with its `.md`
 *  extension (wikilinks drop the extension). Null when the file is gone — soft-deleted
 *  or unreadable files are not content the app can organize from. The file's `path` is
 *  its original-case path as stored, extension included — what a subsequent write must
 *  address, since a wikilink target alone (no `.md`) is not a metadata doc's id. */
async function readSingleFile(path: string, deps: StoreDeps): Promise<VaultFile | null> {
  const files = await readVaultFiles(deps.db, (p) => p === path || p === `${path}.md`);
  const file = files.find((f) => !f.deleted && !f.unreadable);
  return file ?? null;
}

/** Append a capture to an existing Note (ADR-0009): merge the capture into the target
 *  Note's one Dump as a dated verbatim section, then re-organize the Note wholesale from
 *  the accumulated Dump and rewrite it at its frozen path.
 *
 *  The merge is written first and is the point of durability. It is idempotent — the
 *  guard lives inside the transform, so a retry after a mid-flight failure (or a 409
 *  from a device that landed the same section) re-checks against fresh content and never
 *  merges twice. After it lands the accumulated Dump is re-read from the Vault and the
 *  Organize runs over that copy of record — never over a string built in memory, so a
 *  concurrent device's capture is not absent from the rebuilt Note.
 *
 *  With the merge saved, the capture's own Dump file is marked `appendedInto: <the
 *  target Note>` — the thought now lives in the target's Dump, so the file becomes a
 *  pointer: reconciliation counts it filed (no Stranded row) and recovery counts it
 *  organized (no second Note). From here the capture is filed even if the Organize
 *  fails; a failed Organize leaves the old Note intact, and a Re-organize renders the
 *  merged Dump into it.
 *
 *  An old-format Note's body may still carry `## Appended` sections from before this
 *  rework; they are absorbed into the Dump first, so the first Append migrates the Note
 *  rather than dropping the user's earlier captures (ADR-0009). The Note is a view of
 *  the Dump (CONTEXT.md): the rewrite replaces body and frontmatter wholesale, which is
 *  why a hand edit to a Note is provisional. The Note keeps its identity — the frozen
 *  path, the original capture time, the modality, and the single `source` wikilink.
 *
 *  When the target's Dump cannot be read (the user deleted it, or the `source` link
 *  points at a file that is not a Dump), there is nothing to merge into and the capture
 *  still deserves filing: it founds a new Note instead. */
async function appendCaptureToNote(
  session: CaptureSession,
  notePath: string,
  deps: FinalizeDeps,
): Promise<{ note: Note; written: WriteResult; session: CaptureSession }> {
  const target = await readSingleFile(notePath, deps);
  const fm = target ? parseFrontmatter(target.content) : null;
  const dumpFilePath = target && fm?.source ? wikilinkTarget(fm.source) : '';
  let dumpFile = dumpFilePath ? await readSingleFile(dumpFilePath, deps) : null;
  // The `source` link must resolve to a file that IS a Dump — a hand-linked (or corrupt)
  // `source` pointing at a personal note must not have sections merged into it.
  if (dumpFile && !parseDumpFile(dumpFile.content)) dumpFile = null;
  if (!target || !fm || !dumpFile) return foundNewNote(session, deps);

  // 1. Absorb the old format, then merge: every section lands in the target's one Dump
  //    with the same idempotent, 409-safe write, stamped with its capture's own time.
  //    The write addresses the Dump's stored path — the wikilink target has no `.md`,
  //    and the metadata doc does.
  await mergeSection(dumpFile, dumpText(session.dump).trim(), formatStamp(session.dump.createdAt), deps);
  for (const legacy of legacyAppendedSections(target.content)) {
    if (!dumpFile.content.includes(`## Appended ${legacy.stamp}\n`)) {
      await mergeSection(dumpFile, legacy.text, legacy.stamp, deps);
    }
  }

  // 2. Organize from the accumulated Dump as the Vault now holds it — the copy of
  //    record, not a string assembled in memory.
  const mergedFile = (await readSingleFile(dumpFile.path, deps)) ?? dumpFile;
  const { body: dumpBody } = splitFrontmatter(mergedFile.content);
  const out = await deps.organizer.organize(dumpBody, fm.modality);

  // 3. The new Note keeps the target's identity: frozen path, original capture time and
  //    modality, the single source wikilink. Everything else is the organizer's output.
  const organized: Note = {
    title: out.title,
    tags: out.tags,
    createdAt: fm.created,
    modality: fm.modality,
    source: fm.source,
    category: out.category,
    summary: out.summary,
    body: out.body,
    keyPoints: out.keyPoints,
    related: [],
  };
  // 4. Related is recomputed for the Note as it now stands — an Append that changes what
  //    the Note is about may drop links, add them, or keep them (finding 07: they were
  //    computed then discarded).
  const note = await fillRelated(organized, notePath, deps);

  // 5. Rewrite the Note in place at the frozen path. Wholesale, by design: the Note is a
  //    view of the Dump, and this Organize is its newest rendering.
  const { metadataId, chunkId } = await modifyFile(
    deps.db,
    notePath,
    () => noteFileContent(note),
    { mtime: deps.now(), hash: deps.hash, settings: deps.settings },
  );

  // 6. The capture's own Dump file becomes a pointer to the Note that now carries the
  //    thought — filed, not Stranded, and recovery will not found a second Note for it.
  await markAppendedInto(session.dump, notePath, deps);

  return { note, written: { path: notePath, metadataId, chunkId }, session };
}

/** Merge one dated verbatim section into a Dump file. The idempotency check sits inside
 *  the transform so it runs against the freshest content on every 409 retry — a section
 *  a concurrent device already landed is detected there, not against a stale read. */
async function mergeSection(
  dumpFile: VaultFile,
  text: string,
  stamp: string,
  deps: FinalizeDeps,
): Promise<void> {
  const section = `## Appended ${stamp}\n\n${text}`;
  await modifyFile(
    deps.db,
    dumpFile.path,
    (current) =>
      current.includes(section) ? current : `${current.trimEnd()}\n\n${section}\n`,
    { mtime: deps.now(), hash: deps.hash, settings: deps.settings },
  );
}

/** The `## Appended <date>` sections an old-format Note still carries in its body —
 *  pre-ADR-0009 files kept them below `## Related`, each traced by a `_Source:` line.
 *  Parsed back into appendments (the `_Source` line dropped), they are what the first
 *  Append or Re-organize folds into the Note's Dump. */
export function legacyAppendedSections(noteFile: string): DumpAppendment[] {
  const { body } = splitFrontmatter(noteFile);
  return body
    .trimStart()
    .split(/\n+(?=## Appended \d{4}-\d{2}-\d{2} )/)
    .slice(1)
    .map((part) => {
      const nl = part.indexOf('\n');
      const heading = (nl >= 0 ? part.slice(0, nl) : part).trim();
      const raw = nl >= 0 ? part.slice(nl + 1).trim() : '';
      return {
        stamp: heading.replace(/^##\s+Appended\s+/, '').trim(),
        text: raw.replace(/\n*_?[Ss]ource:\s*\[\[[^\]\n]+\]\]\s*$/, '').trim(),
      };
    });
}

/** Point the capture's own Dump file at the Note that absorbed it. Reads the Vault's
 *  copy first, so a hand edit to the file survives the mark; a missing or unparseable
 *  file is left alone — there is nothing to mark. */
async function markAppendedInto(
  dump: Dump,
  notePath: string,
  deps: FinalizeDeps,
): Promise<void> {
  const path = dumpPath(dump, deps.settings);
  const file = await readSingleFile(path, deps);
  const parsed = file ? parseDumpFile(file.content) : null;
  if (!parsed || parsed.appendedInto) return;
  await writeDump({ ...parsed, appendedInto: wikilink(notePath) }, deps);
}

/** The Note with its Related links filled in, or unchanged when the caller supplied no
 *  embedder and judge (the founding path — the append and re-organize paths call
 *  `fillRelated` directly with their own exclude path). */
async function withRelated(
  note: Note,
  session: CaptureSession,
  deps: FinalizeDeps,
): Promise<Note> {
  return fillRelated(note, `${deps.settings.managedFolder}/${noteFilename(note)}`, deps);
}

/** The Note with its Related links resolved against the Vault, excluding `excludePath` —
 *  the Note itself, which must not rank as its own closest match. Best effort: no
 *  embedder and judge means no links, and a resolution failure logs and returns the Note
 *  unchanged rather than costing the user the Note. */
async function fillRelated(
  note: Note,
  excludePath: string,
  deps: {
    db: DocStore;
    settings: Settings;
    embedder?: Embedder;
    relater?: Relater;
    log?: Log;
  },
): Promise<Note> {
  if (!deps.embedder || !deps.relater) return note;

  const relatedDeps: RelatedDeps = {
    db: deps.db,
    settings: deps.settings,
    embedder: deps.embedder,
    relater: deps.relater,
    log: deps.log,
  };

  try {
    return { ...note, related: await findRelated(note, excludePath, relatedDeps) };
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

// --- Append a capture to an existing Note (ADR-0009) ----------------------
// Matching is LLM-assisted (by tags/topic) against the existing Notes in the
// managed folder. Appending merges the capture into the target Note's one Dump
// and re-organizes the Note wholesale from it (ADR-0009) — the Note is a view of
// its Dump, so the rewrite replaces body and frontmatter alike. Writes use
// optimistic concurrency (write with the current `_rev`; on a 409, re-fetch,
// re-apply, retry).

/** The frontmatter fields parsed out of a Note file, in the v1 schema shape. */
export interface ParsedFrontmatter {
  title: string;
  tags: string[];
  summary: string;
  category: Category;
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
    // Coerce the raw frontmatter string into the closed set. A free-form Category on an existing
    // Note (the Vault holds 'Bug Report', 'Hardware', …) reads as `uncategorized` here — the file
    // is never rewritten, only corrected when the user re-organizes (ticket 04; spec.md §Category).
    category: toCategory(fields.category ?? ''),
    created: Number(fields.created ?? 0),
    modality: fields.modality === 'voice' ? 'voice' : 'text',
    source: fields.source ?? '',
  };
}

/** Split the post-frontmatter body into the cleaned content and the three trailing
 *  sections `noteFileContent` appends — Summary, Key points, Related.
 *
 *  The sections are searched from the end, so a `##` heading the organized body
 *  happens to use cannot steal the section boundary: the genuine sections are the
 *  last ones, written in order by `noteFileContent`. A missing section simply yields
 *  an empty list (the body grows to absorb it), so a Note missing its `## Related`
 *  block still reads — Related is empty, the rest is body.
 *
 *  But "last in the file" stopped being proof of section membership when the Append
 *  path wrote its dated sections to the very end of the file, *below* `## Related`
 *  (finding 06) — files in the Vault still carry that layout. So a section's content
 *  runs only as far as its bullets run: the first non-bullet line ends it, and
 *  whatever follows is folded back into the body — an `## Appended …` journal section
 *  is the user's content, never a Related link, and never lost to the sheet. */
function splitNoteBody(raw: string): {
  body: string;
  keyPoints: string[];
  related: string[];
  /** Where the body ends in `raw` — the boundary the Append path inserts a new dated
   *  section at, so writer and reader agree on what the trailing sections are. */
  bodyEnd: number;
} {
  const relIdx = raw.lastIndexOf('\n## Related\n');
  const kpIdx = relIdx >= 0 ? raw.lastIndexOf('\n## Key points\n', relIdx) : raw.lastIndexOf('\n## Key points\n');
  const sumEnd = kpIdx >= 0 ? kpIdx : relIdx >= 0 ? relIdx : raw.length;
  const sumIdx = raw.lastIndexOf('\n## Summary\n', sumEnd);

  // Everything before the first trailing section is the cleaned body. When no section
  // is present (a hand-edited Note, a personal note read by mistake) the whole raw body
  // is the body — nothing is lost.
  const bodyEnd = sumIdx >= 0 ? sumIdx : kpIdx >= 0 ? kpIdx : relIdx >= 0 ? relIdx : raw.length;
  // `splitFrontmatter` leaves the frontmatter separator's trailing newline at the head of
  // the body; strip leading newlines so the organized content is what the sheet shows, not
  // the blank line that separated it from the frontmatter.
  const body = raw.slice(0, bodyEnd).replace(/^\n+/, '').trimEnd();

  /** The bullet list of a trailing section, with where the list stops: blank lines between
   *  bullets are tolerated, the first non-bullet line ends the section, and `end` is the
   *  offset that first non-bullet line starts at (`to` when the list runs to the section's
   *  edge). */
  const sectionScan = (
    from: number,
    to: number,
    header: string,
  ): { items: string[]; end: number } => {
    const start = raw.indexOf(header, from);
    if (start < 0) return { items: [], end: to };
    const lines = raw.slice(start + header.length, to).split('\n');
    const items: string[] = [];
    let end = start + header.length;
    for (const line of lines) {
      const t = line.trim();
      if (!t) {
        end += line.length + 1;
        continue;
      }
      if (!t.startsWith('-')) break;
      items.push(t.replace(/^-\s?/, '').trim());
      end += line.length + 1;
    }
    return { items, end };
  };

  const keyPoints = kpIdx >= 0 ? sectionScan(kpIdx, relIdx >= 0 ? relIdx : raw.length, '## Key points').items : [];
  const rel = relIdx >= 0 ? sectionScan(relIdx, raw.length, '## Related') : { items: [], end: raw.length };
  // Content after the Related list — an `## Appended …` section below the sections — is
  // body again, so the sheet shows the whole journal and the refresh re-organizes all of it.
  const tail = raw.slice(rel.end).trim();
  return {
    body: tail ? `${body}\n\n${tail}` : body,
    keyPoints,
    related: rel.items,
    bodyEnd: tail ? raw.length : bodyEnd,
  };
}

/** Reconstruct the full Note a file holds — the inverse of `noteFileContent`. The
 *  frontmatter yields title/tags/category/summary/created/modality/source; the body is
 *  split back into the cleaned content, the key points and the Related links. This is
 *  what the Note sheet shows: the dry twin of the pre-commit preview, at full length.
 *
 *  Tolerant, like `parseFrontmatter`: a file with no frontmatter still reads (every
 *  field defaults), so a hand-edited Note or a personal note read by mistake degrades
 *  to its body rather than throwing. */
export function parseNote(content: string): Note {
  const fm = parseFrontmatter(content);
  const { body: raw } = splitFrontmatter(content);
  const { body, keyPoints, related } = splitNoteBody(raw);
  return {
    title: fm.title,
    tags: fm.tags,
    createdAt: fm.created,
    modality: fm.modality,
    source: fm.source,
    category: fm.category,
    summary: fm.summary,
    body,
    keyPoints,
    related,
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

// --- The home grid's projection (ticket 02; ADR-0007) ---------------------
// The grid paints a card per Note. Everything a card needs is already in a Note's frontmatter
// and already parsed above; only the projection is new. `category` is the closed-set Category
// coerced in `parseFrontmatter` — the grid derives a hue from it (ticket 04); `uncategorized`
// carries no hue.

/** Project one managed-folder file to a card. */
function toCard(file: VaultFile): NoteCard {
  const fm = parseFrontmatter(file.content);
  return {
    path: file.path,
    title: fm.title,
    category: fm.category,
    summary: fm.summary,
    tags: fm.tags,
    createdAt: fm.created,
  };
}

/** Project a list of managed-folder files to cards, newest-first. The grid's combined read
 *  hands `toCards` the live managed files it filters out of a managed+dumps pass; the caller is
 *  responsible for handing only the files it wants carded. */
function toCards(files: VaultFile[]): NoteCard[] {
  return files
    .map(toCard)
    .sort((a, b) => b.createdAt - a.createdAt || a.path.localeCompare(b.path));
}

/** Write the projection back to the disposable cache, swallowing a failure: the cache is not the
 *  source of truth, and a failed write costs only the next paint. Awaited so a resolved call has
 *  durably stored the cards (a caller that reads the cache straight after sees them). */
async function safeWrite(cache: NoteCardCache | undefined, cards: NoteCard[]): Promise<void> {
  if (!cache) return;
  try {
    await cache.write(cards);
  } catch {
    // A failed write costs only the next paint — the cache is not the source of truth.
  }
}

/** Store deps plus the grid's device-local companions: the card cache (paint before the Vault
 *  read completes) and the Pending/Dismissed stores (Dumps in either are excluded from the
 *  Stranded list — they are known, or the user has chosen to stop hearing about them). All
 *  optional; omit them and the grid reads the Vault alone, reporting every unreferenced Dump. */
export interface GridDeps extends StoreDeps {
  cache?: NoteCardCache;
  pending?: PendingStore;
  dismissed?: DismissedStore;
}

/** The grid's reconciled state from one open: the authoritative Note cards and the Stranded
 *  Dumps, both from the one Vault pass. Cards painted early from a warm cache (via `paint`) are
 *  superseded by these once the pass completes — or kept as-is if the pass fails. */
export interface GridResult {
  cards: NoteCard[];
  stranded: StrandedDump[];
}

/** Read the grid's whole state — Note cards and Stranded Dumps — in one Vault pass
 *  (ADR-0007 / acceptance #2). Cache-first: when the cache holds cards, `paint` is called with
 *  them *before* the Vault read completes, so the grid shows something the moment it opens and
 *  stays populated even when the Vault is slow or unreachable. The pass then reconciles to the
 *  authoritative cards (a Note deleted by Obsidian's own sync disappears; a Stranded Dump
 *  appears) and refreshes the cache; if the pass fails, the painted cached cards are kept and
 *  an empty Stranded list is returned rather than throwing — the grid stays usable, and the next
 *  open retries.
 *
 *  A cold or unreadable cache skips the early paint and falls straight through to the pass. The
 *  cache is disposable — a cache read failure never reaches the caller, because capture must
 *  never be gated on a cache that can be lost. The Stranded list always comes from the pass,
 *  since it is not cached. */
export async function readGrid(
  deps: GridDeps,
  paint?: (cards: NoteCard[]) => void,
): Promise<GridResult> {
  const pendingIds = new Set(
    (deps.pending ? await deps.pending.list() : []).map((r) => r.dump.id),
  );
  const dismissedIds = new Set(deps.dismissed ? await deps.dismissed.list() : []);

  // Warm cache: paint the cached cards before the Vault read completes, then reconcile. A cache
  // read failure is disposable — treat it as cold and read the Vault.
  if (deps.cache) {
    let cached: NoteCard[] | null = null;
    try {
      const listed = await deps.cache.list();
      if (listed.length) cached = listed;
    } catch {
      /* disposable cache — fall through to the Vault read */
    }
    if (cached) {
      paint?.(cached);
      try {
        const vault = await readVaultForGrid(deps, pendingIds, dismissedIds);
        await safeWrite(deps.cache, vault.cards); // keep the cache fresh against the authoritative read
        return { cards: vault.cards, stranded: vault.stranded };
      } catch {
        // The Vault read failed — keep the cards the paint already showed. Stranded is unknown
        // this open; the grid stays usable and the next open retries.
        return { cards: cached, stranded: [] };
      }
    }
  }

  // Cold / empty / failed cache: one Vault pass yields both, and fills the cache for next time.
  const vault = await readVaultForGrid(deps, pendingIds, dismissedIds);
  await safeWrite(deps.cache, vault.cards);
  return { cards: vault.cards, stranded: vault.stranded };
}

/** A Note the user has just committed, as the grid needs to know it: the Note the commit
 *  produced, where it landed in the Vault, and whether it Appended to an existing Note or
 *  founded a new one. */
export interface FiledNote {
  note: Note;
  path: string;
  appended: boolean;
}

/** The grid's cards with a just-committed Note folded in, without reading the Vault again.
 *
 *  Committing returns the user to the grid with the new card at the top, and the card comes
 *  from the Note the commit already produced: the grid is the road to capture, so the capture
 *  path must not pay for a full-Vault round trip to show its own receipt. That shortcut is only
 *  safe because the projection here is the projection `toCard` derives from the same Note's
 *  frontmatter — asserted in tests/cards.test.ts against a real Vault read.
 *
 *  A new Note is prepended rather than sorted in. The card is a receipt, so it goes where the
 *  user will look for it; a Dump captured days ago and filed today would sort further down, and
 *  the next home read restores strict newest-first order anyway.
 *
 *  An Append re-organizes the Note it landed in (ADR-0009), so that Note's card may now
 *  carry a new title or summary — the card is refreshed *in place*, keeping its position:
 *  the Note is the same thought the user filed where it already is, not a new arrival.
 *
 *  The cache is refreshed to match, so the fold survives a restart and the grid does not paint
 *  a stale set of cards before the next Vault read reconciles. A failed cache write costs only
 *  the next paint. */
export async function fileOnGrid(
  cards: NoteCard[],
  filed: FiledNote,
  cache?: NoteCardCache,
): Promise<NoteCard[]> {
  const next = filed.appended
    ? cards.map((c) => (c.path === filed.path ? cardForNote(filed.note, filed.path) : c))
    : [cardForNote(filed.note, filed.path), ...cards.filter((c) => c.path !== filed.path)];
  await safeWrite(cache, next);
  return next;
}

/** Project a Note the app just wrote to its grid card. The counterpart of `toCard`, which
 *  projects the same Note read back out of the Vault — the two must agree field for field. */
function cardForNote(note: Note, path: string): NoteCard {
  return {
    path,
    title: note.title,
    category: note.category,
    summary: note.summary,
    tags: note.tags,
    createdAt: note.createdAt,
  };
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

/** `<YYYY-MM-DD> <HH:MM:SS> UTC` — the stamp on an Appended capture's section inside its
 *  Dump (UTC, like the filenames, so it is deterministic across machines). */
function formatStamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(
    d.getUTCHours(),
  )}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} UTC`;
}

export interface RefreshDeps {
  db: DocStore;
  settings: Settings;
  organizer: Organizer;
  hash: (content: string) => Promise<string>;
  now: () => number;
  /** Supplied to recompute the Note's Related links as part of the re-organize. Omit both
   *  and the rebuilt Note carries no Related links — except when the Note has no Dump, where
   *  the fallback refresh keeps whatever links its file already carries. */
  embedder?: Embedder;
  relater?: Relater;
  log?: Log;
}

/** Explicit, user-triggered Re-organize (ADR-0009): rebuild the Note wholesale from its
 *  Dump — body and frontmatter alike — and recompute Related. The same path as an
 *  Append's re-organize, minus the merge of a new capture (an old-format Note's legacy
 *  `## Appended` sections are still absorbed — they are its content): the Note is a view
 *  of its Dump, so anything worth keeping belongs in the Dump, and this regenerates the
 *  view from the record.
 *
 *  The Organize runs once per user action. In the dump-present branch the rebuilt file
 *  content is computed on the first attempt and re-applied to each 409 retry — a
 *  concurrent hand edit is regenerated over rather than preserved, which is the contract
 *  (the Note is a view of its Dump). In the no-Dump fallback the derived frontmatter is
 *  what is cached; each retry re-applies it to the freshest body on the file, so a
 *  concurrent hand edit there survives.
 *
 *  When the Note's Dump is gone (deleted by the user), the body on the file is all there
 *  is: the frontmatter is re-derived against it and the body preserved byte-for-byte —
 *  the pre-rework metadata-refresh behavior, kept for exactly that case. */
export async function refreshNoteMetadata(
  notePath: string,
  deps: RefreshDeps,
): Promise<WriteResult> {
  let plan:
    | { mode: 'note'; content: string }
    | { mode: 'frontmatter'; fields: RefreshFrontmatter }
    | null = null; // built once, re-applied across 409 retries
  const { metadataId, chunkId } = await modifyFile(
    deps.db,
    notePath,
    async (current) => {
      if (plan === null) plan = await buildReorganized(current, notePath, deps);
      if (plan.mode === 'note') return plan.content;
      // The fallback re-applies only the derived frontmatter to the freshest body — a
      // concurrent hand edit lands between retries is kept, as the pre-rework refresh did.
      return withFrontmatter(plan.fields, splitFrontmatter(current).body);
    },
    { mtime: deps.now(), hash: deps.hash, settings: deps.settings },
  );
  return { path: notePath, metadataId, chunkId };
}

/** A Note file with `frontmatter` re-derived and its existing body untouched — the
 *  trailing sections and any hand-written prose included. */
function withFrontmatter(
  fields: {
    title: string;
    tags: string[];
    createdAt: number;
    modality: Modality;
    source: string;
    category: Category;
    summary: string;
  },
  body: string,
): string {
  return `${noteFrontmatter(fields)}${body.replace(/^\n+/, '')}`;
}

/** The frontmatter a Re-organize re-derives in the no-Dump fallback — the v1 schema's
 *  identity fields, with the body left exactly as the file holds it. */
type RefreshFrontmatter = Pick<
  Note,
  'title' | 'tags' | 'createdAt' | 'modality' | 'source' | 'category' | 'summary'
>;

/** The rebuilt file content for a Re-organize: from the Note's Dump when it exists, from
 *  the file's own body when it does not. */
async function buildReorganized(
  current: string,
  notePath: string,
  deps: RefreshDeps,
): Promise<
  | { mode: 'note'; content: string }
  | { mode: 'frontmatter'; fields: RefreshFrontmatter }
> {
  const fm = parseFrontmatter(current);
  const dumpFilePath = fm.source ? wikilinkTarget(fm.source) : '';
  const dumpFile = dumpFilePath ? await readSingleFile(dumpFilePath, deps) : null;
  const dump = dumpFile ? parseDumpFile(dumpFile.content) : null;

  if (dumpFile && dump) {
    // An old-format Note's body may still carry pre-ADR-0009 `## Appended` sections;
    // they are absorbed into the Dump first, so a Re-organize migrates rather than
    // drops them.
    for (const legacy of legacyAppendedSections(current)) {
      if (!dumpFile.content.includes(`## Appended ${legacy.stamp}\n`)) {
        await mergeSection(dumpFile, legacy.text, legacy.stamp, deps);
      }
    }
    // The accumulated Dump body — every capture, verbatim, first to last. The source the
    // Note is a view of.
    const fresh = (await readSingleFile(dumpFile.path, deps)) ?? dumpFile;
    const { body } = splitFrontmatter(fresh.content);
    const out = await deps.organizer.organize(body, fm.modality);
    const note: Note = {
      title: out.title,
      tags: out.tags,
      createdAt: fm.created,
      modality: fm.modality,
      source: fm.source,
      category: out.category,
      summary: out.summary,
      body: out.body,
      keyPoints: out.keyPoints,
      related: [],
    };
    return { mode: 'note', content: noteFileContent(await fillRelated(note, notePath, deps)) };
  }

  // No Dump behind the Note: the file's own body is all there is. Organize against the
  // user's content alone (never the trailing sections this file appends), preserve the
  // body verbatim — hand-written prose under the trailing sections included — and
  // refresh only the derived frontmatter.
  const { body: raw } = splitFrontmatter(current);
  const { body } = splitNoteBody(raw);
  const out = await deps.organizer.organize(body, fm.modality);
  return {
    mode: 'frontmatter',
    fields: {
      title: out.title,
      tags: out.tags,
      createdAt: fm.created,
      modality: fm.modality,
      source: fm.source,
      category: out.category,
      summary: out.summary,
    },
  };
}

// --- The Note sheet (ticket 06) ------------------------------------------
// The grid's card is a door, not a dead end: tapping it opens the whole Note — the dry
// twin of the pre-commit preview, at full length. Everything the card truncated (Tags,
// the body, the Related links) is shown here untruncated, plus the one thing the card never
// held: the verbatim Dump the Note was organized from, kept as provenance the user can reach
// but not the headline.

/** The full Note as the Note sheet shows it: the reconstructed Note, where it is filed in the
 *  Vault, and the verbatim source Dump (the user's original words, plus any Context they added).
 *  `dump` is null when the source Dump is gone — the Note still reads, provenance and all that
 *  survived. */
export interface NoteView {
  note: Note;
  path: string;
  dump: Dump | null;
}

/** Read one Note out of the Vault as the Note sheet needs it: the full reconstructed Note, its
 *  filed path, and the verbatim source Dump. The Note is read live (a deleted Note is gone, not
 *  shown), and the source Dump is fetched by following the Note's `source` wikilink back to the
 *  Dumps folder — `null` when that Dump no longer exists.
 *
 *  A single-file read: `readVaultFiles` filters by path before any chunk is fetched, so this is
 *  one metadata scan plus the one Note's chunk, not a full-Vault pass. */
export async function readNote(path: string, deps: StoreDeps): Promise<NoteView | null> {
  const files = await readVaultFiles(deps.db, (p) => p === path);
  const file = files.find((f) => f.path === path);
  if (!file) return null; // the Note is gone — deleted, or never at that path
  const note = parseNote(file.content);
  const dump = note.source ? await readSourceDump(note.source, deps) : null;
  return { note, path, dump };
}

/** Read the verbatim Dump a Note's `source` wikilink points at. The wikilink drops the `.md`
 *  extension, so both the bare target and the `.md` path are matched. Returns null when the
 *  Dump is gone or not a Dump (a personal note linked by hand, say). */
async function readSourceDump(source: string, deps: StoreDeps): Promise<Dump | null> {
  const target = wikilinkTarget(source);
  const files = await readVaultFiles(deps.db, (p) => p === target || p === `${target}.md`);
  const file = files.find((f) => !f.deleted);
  if (!file) return null;
  return parseDumpFile(file.content);
}

/** Re-organize an existing Note: re-derive the frontmatter (title/tags/category/summary) from
 *  the current body, preserving the body byte-for-byte, then read the refreshed Note back. The
 *  sheet's re-organize action is the one place this surfaces (ticket 05 left it with no surface);
 *  the operation is `refreshNoteMetadata` plus a re-read, so the sheet can paint the new metadata
 *  without a second call. */
export interface ReorganizeDeps extends RefreshDeps {}

export async function reorganizeNote(path: string, deps: ReorganizeDeps): Promise<NoteView | null> {
  await refreshNoteMetadata(path, deps);
  return readNote(path, deps);
}

// --- The Ask sheet (ticket 07) --------------------------------------------
// Retrieve answers a question and cites the Notes it drew on; the Ask sheet shows those
// citations as the same cards the grid shows, tappable into the Note sheet. A citation carries
// only a path, a title and a wikilink — not the Category, Tags and summary a card needs — so the
// cited Notes are read and projected through the same `toCard` the grid uses. The projection is
// identical by construction (`toCard` over the same Note's frontmatter), so a citation card is a
// grid card, and the only new thing is the order: citations follow the answer, not the grid's
// newest-first order.

/** Project the Notes a Retrieve answer cited to the grid-identical cards the Ask sheet shows.
 *
 *  The cards follow citation order — the user reads the answer top-to-bottom into its sources —
 *  not the grid's newest-first order. A Note deleted between the answer and this read is dropped
 *  rather than shown as a dead card: `readVaultFiles` excludes soft-deleted docs by default, so a
 *  gone citation is simply absent. A single narrowed read fetches only the cited paths. */
export async function citedCards(
  citations: Citation[],
  deps: StoreDeps,
): Promise<NoteCard[]> {
  if (!citations.length) return [];
  const paths = new Set(citations.map((c) => c.path));
  const files = await readVaultFiles(deps.db, (p) => paths.has(p));
  const byPath = new Map(files.map((f) => [f.path, f] as const));
  return citations.map((c) => byPath.get(c.path)).filter((f): f is VaultFile => !!f).map(toCard);
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
  /** Feeds the cross-cutting status strip (ticket 09). The operation emits a `capture-confirmed`
   *  message here when a capture lands with no card to show it — offline, or failed while
   *  online — so the strip's source is the operation layer, assertable at this seam. A capture
   *  that opens a review session emits nothing: the Note on screen is the receipt. */
  onStatus?: OnStatus;
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
  const onStatus = deps.onStatus ?? noopStatus;
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
    onStatus(captureConfirmedMessage('offline', OFFLINE_CAPTURE_MESSAGE));
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
    onStatus(captureConfirmedMessage('capture-failed', CAPTURE_RETRY_MESSAGE, error as Error));
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
  /** Optional, like everywhere else Related appears: no embedder and judge means no links,
   *  and a failed pass logs and writes the Note anyway. Recovery is where the wait is
   *  freest — nobody is watching — so the pass has no deadline here (capture-latency
   *  ticket 05). */
  embedder?: Embedder;
  relater?: Relater;
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
  const vault: VaultState = due.length
    ? await readVaultState(deps)
    : { dumps: new Map(), referenced: new Set(), brokenRefs: new Map() };

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
      // `referenced` counts live Notes only, so a Dump whose Note has since been deleted
      // is recovered rather than treated as filed.
      const dump = vault.dumps.get(path)?.dump ?? record.dump;
      const dumpWrite = await writeDump(dump, deps);
      // Related is computed here, between the Organize and the write, exactly as the
      // founding path does (capture-latency ticket 05) — recovery is the path every offline
      // Capture takes, and its Notes used to land with an empty section by construction.
      // Nobody is watching, so the pass keeps its place and takes no deadline; the
      // best-effort contract (`fillRelated`) means a failed pass costs links, never the Note.
      // The organizer's own `related` output is dropped first, as on the append path: the
      // organizer has never seen the Vault, and a link it invents is a dead one.
      const organized = await organizeNote(dump, deps.organizer, deps.settings);
      const note = await fillRelated(
        { ...organized, related: [] },
        `${deps.settings.managedFolder}/${noteFilename(organized)}`,
        deps,
      );
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
 *  the `_Source:` line of each appended dated section. The `_Source:` form matters for
 *  old-format files: under ADR-0009 an Appended capture is filed by the `appendedInto`
 *  pointer its own Dump file carries instead (see `buildVaultState`). */
export function referencedDumpLinks(files: Array<{ content: string }>): Set<string> {
  const links = new Set<string>();
  for (const file of files) {
    for (const match of file.content.matchAll(/^_?[Ss]ource:\s*(\[\[[^\]\n]+\]\])/gm)) {
      links.add(match[1]);
    }
  }
  return links;
}

/** Parse a Dump back out of its file — the inverse of `dumpFileContent`. The body is a
 *  run of sections: the verbatim original, then optional Context, then any Appended
 *  captures. Each keeps its own text, so a Dump that has grown by Appends round-trips
 *  exactly — a rewrite (a recovery re-syncing the file) never drops an Appended capture.
 *  Returns null for a file that is not a Dump (no id in the frontmatter), so a stray
 *  file in the Dumps folder is skipped rather than half-read. */
export function parseDumpFile(content: string): Dump | null {
  const { fields, body } = splitFrontmatter(content);
  if (!fields.id) return null;
  // Only `## Appended <date>` is a top-level section boundary; `## Context` bounds the
  // founding capture's Context inside the head. An Appended capture's own `## Context`
  // must not become the founding Dump's — it is verbatim text inside the appended
  // section — so the Appended split runs first. (The body leads with a newline before
  // `## Original`; without the trim the split would open with an empty part and the
  // original would read as empty.)
  const parts = body.trimStart().split(/\n+(?=## Appended \d{4}-\d{2}-\d{2} )/);
  const head = parts.shift() ?? '';
  const [originalPart = '', contextPart] = head.split(/\n+##\s+Context\s*\n+/);
  const original = originalPart.replace(/^\s*##\s+Original\s*\n+/, '').trim();
  const appended: DumpAppendment[] = [];
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const heading = (nl >= 0 ? part.slice(0, nl) : part).trim();
    const text = nl >= 0 ? part.slice(nl + 1).trim() : '';
    appended.push({ stamp: heading.replace(/^##\s+Appended\s+/, '').trim(), text });
  }
  return {
    id: fields.id,
    content: original,
    context: contextPart?.trim() ?? '',
    createdAt: Number(fields.created ?? 0),
    modality: fields.modality === 'voice' ? 'voice' : 'text',
    appended,
    ...(fields.appendedInto ? { appendedInto: fields.appendedInto } : {}),
  };
}

/** One read of both Managed folders, deleted documents included — reconciliation is the
 *  one caller that must see them, because a deleted Note is one of the things it reports.
 *
 *  `referenced` holds only the Dumps cited by a Note that is both live **and** readable: a
 *  Note Obsidian will not write to disk files nothing, however healthy it looks here.
 *  `brokenRefs` maps a cited Dump to that Note, so the row can name the document to repair. */
interface VaultState {
  dumps: Map<string, { dump: Dump; deleted: boolean }>;
  referenced: Set<string>;
  brokenRefs: Map<string, { path: string; deleted: boolean }>;
}

/** Read every managed Note and every Dump — the documents reconciliation and the grid both
 *  care about — including soft-deleted ones. One read shared by `readVaultState` and the grid's
 *  `readVaultForGrid`, so the grid's single pass yields both the cards and the Stranded list
 *  (ADR-0007). */
async function readReconcileFiles(deps: StoreDeps): Promise<VaultFile[]> {
  const { managedFolder, dumpsFolder } = deps.settings;
  return readVaultFiles(
    deps.db,
    (path) => path.startsWith(`${managedFolder}/`) || path.startsWith(`${dumpsFolder}/`),
    { includeDeleted: true },
  );
}

/** Build the reconciliation view of the Vault from already-read files. Pure, so the grid can
 *  derive its Stranded list from the same files it builds cards from, without a second read. */
function buildVaultState(files: VaultFile[], settings: Settings): VaultState {
  const { managedFolder, dumpsFolder } = settings;

  const dumps = new Map<string, { dump: Dump; deleted: boolean }>();
  for (const file of files) {
    if (!file.path.startsWith(`${dumpsFolder}/`)) continue;
    const dump = parseDumpFile(file.content);
    if (dump) dumps.set(file.path, { dump, deleted: !!file.deleted });
  }

  const notes = files.filter((f) => f.path.startsWith(`${managedFolder}/`));
  const referenced = referencedDumpLinks(notes.filter((f) => !f.deleted && !f.unreadable));
  // A Dump whose capture was Appended into another Note's Dump is filed — the pointer in
  // its frontmatter names the Note that carries the thought. Without this the grid would
  // show the just-appended capture as Stranded `unfiled`, and recovery would organize a
  // second Note for a thought already inside its target.
  for (const [, { dump }] of dumps) {
    if (dump.appendedInto) referenced.add(wikilink(dumpPath(dump, settings)));
  }
  const brokenRefs = new Map<string, { path: string; deleted: boolean }>();
  for (const note of notes.filter((f) => f.deleted || f.unreadable)) {
    for (const link of referencedDumpLinks([note])) {
      if (!brokenRefs.has(link)) brokenRefs.set(link, { path: note.path, deleted: !!note.deleted });
    }
  }
  return { dumps, referenced, brokenRefs };
}

async function readVaultState(deps: StoreDeps): Promise<VaultState> {
  return buildVaultState(await readReconcileFiles(deps), deps.settings);
}

/** Every Dump in `state` that no live Note cites and that `include` admits — the Stranded
 *  thoughts (CONTEXT.md), or, with the predicate inverted, the Dismissed ones. Pure: the reason
 *  cascade (`dump-deleted` > `unfiled` > `note-deleted` > `note-unreadable`), the `notePath`
 *  spread, the membership test, and the oldest-first sort. The log stays with the caller —
 *  `findStrandedDumps` / `findDismissedDumps` for the Settings flow, the grid otherwise — because
 *  it is a property of *running* a reconciliation, not of *deriving* the list. */
function deriveStranded(
  state: VaultState,
  include: (dumpId: string) => boolean,
): StrandedDump[] {
  const { dumps, referenced, brokenRefs } = state;
  const stranded: StrandedDump[] = [];
  for (const [path, { dump, deleted }] of dumps) {
    const link = wikilink(path);
    // A live Note cites it: filed, whatever else is true.
    if (referenced.has(link)) continue;
    if (!include(dump.id)) continue;
    const broken = brokenRefs.get(link);
    // The Dump's own deletion outranks its Note's: restoring the Note alone would leave
    // the thought itself out of the Vault.
    const reason: StrandedReason = deleted
      ? 'dump-deleted'
      : !broken
        ? 'unfiled'
        : broken.deleted
          ? 'note-deleted'
          : 'note-unreadable';
    stranded.push({ dump, reason, ...(broken ? { notePath: broken.path } : {}) });
  }
  return stranded.sort(
    (a, b) => a.dump.createdAt - b.dump.createdAt || a.dump.id.localeCompare(b.dump.id),
  );
}

/** The membership a Stranded list keeps: a Dump that is neither Pending (known — recovery is
 *  handling it) nor Dismissed (the user set it aside). The mirror of `findDismissedDumps`'s
 *  `(id) => dismissedIds.has(id)`, named once so the grid pass and the Settings reconcile share one
 *  shape instead of two inline copies of the same predicate. */
function notExcluded(pendingIds: Set<string>, dismissedIds: Set<string>): (id: string) => boolean {
  return (id) => !pendingIds.has(id) && !dismissedIds.has(id);
}

/** One Vault pass yields the grid's Note cards AND its Stranded Dumps (ADR-0007 / acceptance #2).
 *  The cards are the live managed files projected through `toCards` (matching the 02 projection:
 *  unreadable Notes still carded, soft-deleted ones excluded); the Stranded list is
 *  `deriveStranded` over the same state. `pendingIds` and `dismissedIds` are passed in already
 *  resolved, so the grid's caller — which has the device-local stores — decides exclusion. */
export async function readVaultForGrid(
  deps: StoreDeps,
  pendingIds: Set<string>,
  dismissedIds: Set<string>,
): Promise<{ cards: NoteCard[]; stranded: StrandedDump[] }> {
  const files = await readReconcileFiles(deps);
  const state = buildVaultState(files, deps.settings);
  const cards = toCards(
    files.filter(
      (f) => f.path.startsWith(`${deps.settings.managedFolder}/`) && !f.deleted,
    ),
  );
  const stranded = deriveStranded(state, notExcluded(pendingIds, dismissedIds));
  return { cards, stranded };
}

export interface ReconcileDeps extends StoreDeps {
  /** Optional. Dumps already in the Pending store are excluded from the result: they are
   *  known, and recovery is about to deal with them. Omit it and every unreferenced Dump in
   *  the Vault is reported, which is what a test asking only about the Vault wants. */
  pending?: PendingStore;
  /** Optional. Dumps the user has decided not to file are excluded — that is the whole
   *  point of dismissing one. */
  dismissed?: DismissedStore;
}

/** Every Dump in the Vault that no Note cites — the thoughts the app took and never
 *  filed (CONTEXT.md: Stranded). This is the check from finding 02, run by the app
 *  instead of by hand.
 *
 *  Dumps already in the Pending store are excluded: they are known, and recovery is
 *  about to deal with them. Oldest first. */
export async function findStrandedDumps(deps: ReconcileDeps): Promise<StrandedDump[]> {
  const state = await readVaultState(deps);
  const records = deps.pending ? await deps.pending.list() : [];
  const pendingIds = new Set(records.map((r) => r.dump.id));
  const dismissedIds = new Set(deps.dismissed ? await deps.dismissed.list() : []);
  const stranded = deriveStranded(state, notExcluded(pendingIds, dismissedIds));

  (deps.log ?? noopLog)({
    op: 'reconcile',
    message: 'Vault reconciled',
    detail: {
      dumps: state.dumps.size,
      referenced: state.referenced.size,
      stranded: stranded.length,
      byReason: stranded.reduce<Record<string, number>>(
        (acc, s) => ({ ...acc, [s.reason]: (acc[s.reason] ?? 0) + 1 }),
        {},
      ),
    },
  });
  return stranded;
}

/** The Dumps the user has dismissed — the thoughts they saw in the Stranded list and decided not
 *  to file (CONTEXT.md: Dismissed). This is `deriveStranded` with the membership inverted: where
 *  `findStrandedDumps` *excludes* dismissed ids, this *includes* only them, so the Settings sheet
 *  can list the dismissed thoughts and offer Restore. Each carries the reason it was stranded for,
 *  so the user can tell what restoring would put back.
 *
 *  Dismissing writes nothing to the Vault, so a Dump listed here is exactly where it was — still
 *  unreferenced and still readable. A dismissed Dump a live Note has since cited (filed after the
 *  dismissal) is not listed: it is no longer stranded-shaped, and restoring it would strand
 *  nothing. */
export async function findDismissedDumps(deps: ReconcileDeps): Promise<StrandedDump[]> {
  const state = await readVaultState(deps);
  const dismissedIds = new Set(deps.dismissed ? await deps.dismissed.list() : []);
  return deriveStranded(state, (id) => dismissedIds.has(id));
}

/** Undo the deletion that stranded a Dump: bring back the Note, and the Dump too when it
 *  was deleted as well. A soft delete keeps every chunk, so this restores the documents
 *  exactly as they were — the user's edits included — and spends no LLM call.
 *
 *  Restoring a Dump whose Note was never written is meaningless, so `unfiled` is a no-op
 *  here: that one wants Organize, not restore. */
export async function restoreStranded(stranded: StrandedDump, deps: StoreDeps): Promise<void> {
  const log = deps.log ?? noopLog;
  if (stranded.reason === 'dump-deleted') {
    await restoreFile(deps.db, dumpPath(stranded.dump, deps.settings), deps.settings);
  }
  if (stranded.notePath) await restoreFile(deps.db, stranded.notePath, deps.settings);
  log({
    op: 'reconcile',
    message: 'restored a deleted document',
    detail: { dumpId: stranded.dump.id, reason: stranded.reason, notePath: stranded.notePath },
  });
}

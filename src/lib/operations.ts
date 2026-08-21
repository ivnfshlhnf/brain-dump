// The operation layer — the seam the UI calls and the unit under test (Seam A).
import type { DocStore, Dump, Note, Organizer, Settings } from './types';
import { writeFile } from './livesync';

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
  const content = text.trim();
  if (!content) throw new Error('Cannot capture an empty brain-dump.');

  const createdAt = deps.now();
  const id = deps.newId();
  const dump: Dump = { id, content, context: '', createdAt, modality: 'text' };

  const path = `${deps.settings.dumpsFolder}/${dumpFilename(createdAt, id)}`;
  const written = await writeAt(deps.db, path, dumpFileContent(dump), createdAt, deps);

  return { dump, ...written };
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

/** Obsidian wikilink to the source Dump, by vault-relative path without extension. */
export function sourceWikilink(dump: Dump, settings: Settings): string {
  const basename = dumpFilename(dump.createdAt, dump.id).replace(/\.md$/, '');
  return `[[${settings.dumpsFolder}/${basename}]]`;
}

/** Note file: v1 frontmatter schema + cleaned body + Summary/Key points/Related sections. */
export function noteFileContent(note: Note): string {
  return `---
title: ${note.title}
tags: [${note.tags.join(', ')}]
created: ${note.createdAt}
modality: ${note.modality}
source: ${note.source}
category: ${note.category}
summary: ${note.summary}
---

${note.body}

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
  note?: Note; // the suggested existing Note when 'append'
}

/** An in-flight capture review session: the captured Dump, the initial Organize
 *  preview (held while Context is added), the match decision, and saved state. */
export interface CaptureSession {
  dump: Dump; // the captured Dump (original + accumulating Context)
  preview: Note; // the initial Organize preview — held, not re-organized per edit
  match: MatchDecision; // new vs append (ticket 04 fills matching)
  saved: boolean; // true once the Note has been written and the Dump frozen
}

/** Deps to begin a capture review session (capture's deps plus the Organizer). */
export interface BeginCaptureDeps extends CaptureDeps {
  organizer: Organizer;
}

/** Deps to add Context to a session's Dump (rewrite the Dump file). */
export interface ContextDeps {
  db: DocStore;
  settings: Settings;
  hash: (content: string) => Promise<string>;
}

/** Deps to finalize a session (final Organize + write the Note). */
export interface FinalizeDeps {
  db: DocStore;
  settings: Settings;
  organizer: Organizer;
  hash: (content: string) => Promise<string>;
}

/** Begin a capture review session: save the verbatim Dump immediately, run the
 *  initial Organize for the preview, and return the new-vs-append decision. */
export async function beginCapture(
  text: string,
  deps: BeginCaptureDeps,
): Promise<CaptureSession> {
  const { dump } = await capture(text, deps);
  const preview = await organizeNote(dump, deps.organizer, deps.settings);
  return { dump, preview, match: { kind: 'new' }, saved: false };
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
  const path = `${deps.settings.dumpsFolder}/${dumpFilename(dump.createdAt, dump.id)}`;
  await writeAt(deps.db, path, dumpFileContent(dump), dump.createdAt, deps);

  return { ...session, dump };
}

export type FinalizeResult =
  | { ok: true; note: Note; session: CaptureSession; written: WriteResult }
  | { ok: false; note: Note; session: CaptureSession; error: Error };

/** Finalize a capture: run the final Organize over the full Dump (original +
 *  Context), write the Note, and freeze the Dump. If the final save fails, the
 *  Dump persists (Context already written) and the Note is generated from it
 *  later — the session stays unsaved so the user can retry. */
export async function finalizeCapture(
  session: CaptureSession,
  deps: FinalizeDeps,
): Promise<FinalizeResult> {
  if (session.saved) throw new Error('Already saved.');

  const note = await organizeNote(session.dump, deps.organizer, deps.settings);
  try {
    const written = await writeNote(note, deps.db, deps.settings, deps.hash);
    return { ok: true, note, written, session: { ...session, saved: true } };
  } catch (error) {
    return { ok: false, note, error: error as Error, session: { ...session, saved: false } };
  }
}

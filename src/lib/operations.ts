// The operation layer — the seam the UI calls and the unit under test (Seam A).
import type { DocStore, Dump, Note, Organizer, Settings } from './types';
import { writeFile } from './livesync';

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
  const dump: Dump = { id, content, createdAt, modality: 'text' };

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

/** Minimal frontmatter + the verbatim body. The verbatim original is preserved inside. */
export function dumpFileContent(dump: Dump): string {
  return `---
id: ${dump.id}
created: ${dump.createdAt}
modality: ${dump.modality}
---

${dump.content}
`;
}

/** Organize a Dump into a Note via the cloud LLM, then write it to the managed folder. */
export async function organizeDump(dump: Dump, deps: OrganizeDeps): Promise<OrganizeResult> {
  const output = await deps.organizer.organize(dump.content, dump.modality);
  const note: Note = {
    title: output.title,
    tags: output.tags,
    createdAt: dump.createdAt,
    modality: dump.modality,
    source: sourceWikilink(dump, deps.settings),
    category: output.category,
    summary: output.summary,
    body: output.body,
    keyPoints: output.keyPoints,
    related: output.related,
  };

  const path = `${deps.settings.managedFolder}/${noteFilename(note)}`;
  const written = await writeAt(deps.db, path, noteFileContent(note), note.createdAt, deps);

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

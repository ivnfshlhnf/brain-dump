// The operation layer — the seam the UI calls and the unit under test (Seam A).
import type { DocStore, Dump, Settings } from './types';
import { writeFile } from './livesync';

export interface CaptureDeps {
  db: DocStore;
  settings: Settings;
  now: () => number;
  newId: () => string;
  hash: (content: string) => Promise<string>;
}

export interface CaptureResult {
  dump: Dump;
  path: string;
  metadataId: string;
  chunkId: string;
}

/** Capture a text brain-dump: write a verbatim Dump to _dumps/ in LiveSync format. */
export async function capture(text: string, deps: CaptureDeps): Promise<CaptureResult> {
  const content = text.trim();
  if (!content) throw new Error('Cannot capture an empty brain-dump.');

  const createdAt = deps.now();
  const id = deps.newId();
  const dump: Dump = { id, content, createdAt, modality: 'text' };

  const path = `${deps.settings.dumpsFolder}/${dumpFilename(createdAt, id)}`;
  const { metadataId, chunkId } = await writeFile(deps.db, path, dumpFileContent(dump), {
    ctime: createdAt,
    mtime: createdAt,
    hash: deps.hash,
    settings: deps.settings,
  });

  return { dump, path, metadataId, chunkId };
}

/** <YYYYMMDD>-<HHMMSS>-<shortid>.md — UTC, so filenames are deterministic across machines. */
export function dumpFilename(createdAt: number, id: string): string {
  const d = new Date(createdAt);
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(
    d.getUTCHours(),
  )}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
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
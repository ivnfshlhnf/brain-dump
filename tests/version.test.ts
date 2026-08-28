// The version line in the Settings sheet ( Seam B for it is just text). What is
// testable is the resolution and the rendering: which commit the running server was started
// from, and when — the two facts that let the phone's sheet be compared against the machine's
// to answer "am I up to date?".
import { describe, it, expect } from 'vitest';
import { versionLabel, type AppVersion } from '../src/lib/version';

// 2026-08-28 20:31:07 UTC — the same frozen stamp the rest of the suite uses variations of.
const startedAt = Date.UTC(2026, 7, 28, 20, 31, 7);

describe('versionLabel', () => {
  it('names the commit and the UTC time the server came up', () => {
    const v: AppVersion = { commit: '64541ad', startedAt };
    const label = versionLabel(v);

    expect(label).toContain('64541ad');
    expect(label).toContain('20:31');
    expect(label).toContain('UTC');
  });

  it('pads the clock — a 9:05 start does not read as 9:5', () => {
    const v: AppVersion = { commit: '64541ad', startedAt: Date.UTC(2026, 7, 28, 9, 5, 0) };
    expect(versionLabel(v)).toContain('09:05');
  });

  it('says nothing about a server it cannot identify', () => {
    // No injection (a plain vitest run, or a build without the define) — the line must
    // still render, honestly, rather than crash the Settings sheet.
    const v: AppVersion = { commit: 'unknown', startedAt: 0 };
    expect(versionLabel(v)).not.toContain('undefined');
    expect(versionLabel(v)).not.toContain('NaN');
  });
});
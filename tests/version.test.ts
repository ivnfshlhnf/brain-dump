// The version line in the Settings sheet ( Seam B for it is just text). What is
// testable is the resolution and the rendering: which commit the running build was made
// from, and when — the two facts that let the phone's sheet be compared against the
// machine's to answer "am I up to date?".
import { describe, it, expect } from 'vitest';
import { versionLabel, type AppVersion } from '../src/lib/version';

// 2026-08-28 20:31:07 UTC — the same frozen stamp the rest of the suite uses variations of.
const builtAt = Date.UTC(2026, 7, 28, 20, 31, 7);

describe('versionLabel', () => {
  it('names the commit and the UTC time the build was made', () => {
    const v: AppVersion = { commit: '64541ad', builtAt };
    const label = versionLabel(v);

    expect(label).toContain('64541ad');
    expect(label).toContain('built');
    expect(label).toContain('20:31');
    expect(label).toContain('UTC');
    // The old server-uptime wording must be gone: on the Host the stamp is the build
    // moment, however long ago it was deployed, not anything that "came up".
    expect(label).not.toContain('up since');
  });

  it('pads the clock — a 9:05 build does not read as 9:5', () => {
    const v: AppVersion = { commit: '64541ad', builtAt: Date.UTC(2026, 7, 28, 9, 5, 0) };
    expect(versionLabel(v)).toContain('09:05');
  });

  it('says nothing about a build it cannot identify', () => {
    // No injection (a plain vitest run, or a build without the define) — the line must
    // still render, honestly, rather than crash the Settings sheet.
    const v: AppVersion = { commit: 'unknown', builtAt: 0 };
    expect(versionLabel(v)).not.toContain('undefined');
    expect(versionLabel(v)).not.toContain('NaN');
  });
});
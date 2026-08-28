// The app's version line — shown at the foot of the Settings sheet.
//
// The version is not package.json's semver (it has never been bumped) but the commit the
// running server was started from, plus when it came up. Those two facts answer the only
// question the line exists for: opening Settings on the phone and comparing its commit
// against the machine's tells you whether the PWA is serving what was just built.
//
// The value is injected by vite.config.ts as a `define` — evaluated once when the dev
// server starts (or at build time), because that is exactly the moment "this version"
// begins. In a plain vitest run no injection exists, so `appVersion()` falls back to
// `unknown` and the line renders honestly instead of crashing the sheet.

/** What the build injected: the server's commit and start time (ms epoch, 0 when unknown). */
export interface AppVersion {
  commit: string; // short git sha, or 'unknown' when it could not be read
  startedAt: number; // ms epoch — when this server/build came up; 0 when unknown
}

declare const __APP_VERSION__: AppVersion | undefined;

export function appVersion(): AppVersion {
  return typeof __APP_VERSION__ === 'undefined' ? { commit: 'unknown', startedAt: 0 } : __APP_VERSION__;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** The one-line rendering the Settings sheet shows: `64541ad · up since 20:31 UTC`. */
export function versionLabel(v: AppVersion): string {
  if (v.commit === 'unknown') return 'version unknown';
  const t = new Date(v.startedAt);
  return `${v.commit} · up since ${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())} UTC`;
}
/// <reference types="vitest/config" />
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

const require = createRequire(import.meta.url);

/** The version the Settings sheet shows: the commit this server was started from, and when
 *  it came up. Evaluated once at config load — dev-server start, or build time — which is
 *  exactly the moment "this version" begins. The phone's sheet shows the same line, so
 *  comparing commits answers "is the PWA serving what was just built?". */
function appVersionDefine(): Record<string, string> {
  let commit = 'unknown';
  try {
    // execFileSync — a fixed argument list, no shell — for the same reason the log sink is
    // hand-rolled: diagnostics must never be able to run anything but this.
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: process.cwd() })
      .toString()
      .trim();
  } catch {
    // Not a git checkout (or git is unavailable): the sheet says "version unknown".
  }
  return { __APP_VERSION__: JSON.stringify({ commit, startedAt: Date.now() }) };
}

/** Dev-only: let the running app write its diagnostic log to the project folder.
 *
 *  A browser cannot touch the filesystem, so `createDevFileSink()` in src/lib/logger.ts
 *  POSTs each event here and this middleware appends it to `logs/brain-dump.jsonl` (one
 *  JSON object per line — greppable by a human, parseable by an agent). Dev server only:
 *  `configureServer` never runs for a production build, so the shipped PWA has no such
 *  endpoint and no way to write anywhere.
 *
 *  The log file is gitignored — it describes a real vault. */
function devLogFile(logPath = 'logs/brain-dump.jsonl'): Plugin {
  const file = resolve(process.cwd(), logPath);
  return {
    name: 'brain-dump-dev-log',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__brain-dump-log', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
          try {
            await mkdir(dirname(file), { recursive: true });
            await appendFile(file, body.trim() + '\n', 'utf8');
          } catch {
            // Diagnostics must never break the app: swallow and still answer 204.
          }
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}

export default defineConfig({
  define: appVersionDefine(),
  server: {
    // The dev server is reached through `tailscale serve` for PWA dogfooding on the
    // phone; Vite's DNS-rebinding guard would otherwise 403 the *.ts.net host.
    allowedHosts: ['.ts.net'],
  },
  resolve: {
    alias: {
      // PouchDB core assumes Node's `events` EventEmitter. Alias to the browser
      // polyfill so the PWA bundle actually loads in a browser.
      events: require.resolve('events'),
    },
  },
  plugins: [
    svelte(),
    devLogFile(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // Workbox's default globs do not include fonts. Brain-dump self-hosts its two
        // faces precisely so the app keeps its typography offline — where the offline
        // outbox matters most — so the woff2 files must be precached like any other asset.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
      manifest: {
        name: 'Brain-dump',
        short_name: 'Brain-dump',
        display: 'standalone',
        start_url: '/',
        // The light ground; the dark equivalent is declared per-scheme in index.html,
        // which a manifest cannot express.
        background_color: '#f0f6fa',
        theme_color: '#f0f6fa',
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // PouchDB core is CJS; without inlining, vitest loads it as a second instance inside
    // src/lib/db.ts, so the http adapter registered in a test is not visible to
    // `createRemoteDb`'s private PouchDB (it throws "Invalid Adapter: undefined").
    // Inlining keeps a single shared instance, matching the browser bundle's assumption.
    server: { deps: { inline: ['pouchdb-core', 'pouchdb-adapter-http'] } },
  },
});
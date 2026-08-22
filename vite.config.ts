/// <reference types="vitest/config" />
import { createRequire } from 'node:module';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

const require = createRequire(import.meta.url);

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
      manifest: {
        name: 'Brain-dump',
        short_name: 'Brain-dump',
        display: 'standalone',
        start_url: '/',
        background_color: '#ffffff',
        theme_color: '#ffffff',
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
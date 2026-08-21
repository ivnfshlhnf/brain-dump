/// <reference types="vitest/config" />
import { createRequire } from 'node:module';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

const require = createRequire(import.meta.url);

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
  },
});
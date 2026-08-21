<script lang="ts">
  import { onMount } from 'svelte';
  import { loadSettings, saveSettings } from './lib/settings';
  import { createRemoteDb } from './lib/db';
  import { capture, organizeDump } from './lib/operations';
  import { createOrganizer } from './lib/llm';
  import { defaultSha1Hex } from './lib/livesync';
  import { DEFAULT_SETTINGS, type Settings } from './lib/types';

  let settings: Settings = { ...DEFAULT_SETTINGS };
  let text = '';
  let status = '';
  let view: 'capture' | 'config' = 'capture';
  let busy = false;

  onMount(async () => {
    settings = await loadSettings();
  });

  async function captureDump() {
    busy = true;
    status = '';
    try {
      const db = createRemoteDb(settings);
      const hash = defaultSha1Hex;
      const captured = await capture(text, {
        db,
        settings,
        now: () => Date.now(),
        newId: () => crypto.randomUUID(),
        hash,
      });
      // Initial Organize: turn the Dump into a Note in the managed folder.
      const organized = await organizeDump(captured.dump, {
        db,
        settings,
        organizer: createOrganizer(settings),
        hash,
      });
      status = `Captured dump to ${captured.path}; Note at ${organized.path}`;
      text = '';
    } catch (e) {
      status = `Error: ${(e as Error).message}`;
    } finally {
      busy = false;
    }
  }

  async function saveConfig() {
    await saveSettings(settings);
    status = 'Settings saved';
  }
</script>

<main>
  <nav>
    <button class:on={view === 'capture'} on:click={() => (view = 'capture')}>Capture</button>
    <button class:on={view === 'config'} on:click={() => (view = 'config')}>Config</button>
  </nav>

  {#if view === 'capture'}
    <textarea
      bind:value={text}
      placeholder="Dump a thought..."
      disabled={busy}></textarea>
    <button on:click={captureDump} disabled={busy || !text.trim()}>Capture</button>
  {:else}
    <label>CouchDB URL <input bind:value={settings.couchdbUrl} placeholder="http://localhost:5984" /></label>
    <label>Database <input bind:value={settings.couchdbDb} placeholder="obsidiannotes" /></label>
    <label>Username <input bind:value={settings.couchdbUser} /></label>
    <label>Password <input type="password" bind:value={settings.couchdbPassword} /></label>
    <label>Managed folder <input bind:value={settings.managedFolder} /></label>
    <label>Case-sensitive <input type="checkbox" bind:checked={settings.caseSensitive} /></label>
    <label>LLM provider <input bind:value={settings.llmProvider} placeholder="https://api.ollama.cloud" /></label>
    <label>LLM model <input bind:value={settings.llmModel} placeholder="llama3.1" /></label>
    <label>LLM API key <input type="password" bind:value={settings.llmApiKey} /></label>
    <button on:click={saveConfig}>Save settings</button>
  {/if}

  {#if status}<p>{status}</p>{/if}
</main>
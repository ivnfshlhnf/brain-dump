<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { loadSettings, saveSettings } from './lib/settings';
  import { createRemoteDb } from './lib/db';
  import {
    captureOrQueue,
    addContext,
    finalizeCapture,
    refreshNoteMetadata,
    drainOutbox,
    type CaptureSession,
  } from './lib/operations';
  import { createIndexedDbOutbox } from './lib/outbox';
  import { retrieve } from './lib/retrieve';
  import { createOrganizer, createMatcher, createEmbedder, createAnswerer } from './lib/llm';
  import { defaultSha1Hex } from './lib/livesync';
  import { createAutosaver } from './lib/autosave';
  import { DEFAULT_SETTINGS, type Settings, type Citation } from './lib/types';

  let settings: Settings = { ...DEFAULT_SETTINGS };
  let text = '';
  let status = '';
  let view: 'capture' | 'ask' | 'config' = 'capture';
  let busy = false;

  // The in-flight capture review session: holds the captured Dump, the initial
  // Organize preview (held while Context is added), and the new-vs-append match.
  let session: CaptureSession | null = null;
  let context = '';
  // The vault path of the last saved Note — used by the explicit Refresh metadata action.
  let savedNotePath: string | null = null;
  // Append requires explicit user confirmation (spec: "the user confirms … with one
  // action"). The 5s autosave may finalize a 'new' decision on its own, but an 'append'
  // decision is held until the user taps Append — so the autosave no-ops an
  // unconfirmed append rather than silently appending.
  let appendConfirmed = false;
  // Retrieve: a question over the whole vault, and the answer with its citations.
  let question = '';
  let answer = '';
  let citations: Citation[] = [];
  let asking = false;

  // The durable offline queue. A Capture with no connection lands here and is
  // Organized on reconnect; `queuedCount` keeps the user informed that it is safe.
  const outbox = createIndexedDbOutbox();
  let queuedCount = 0;
  let queueError = '';
  let draining = false;
  // While Dumps are queued, retry on a timer as well as on the `online` event: a
  // capture that failed while `navigator.onLine` was already true (a flaky
  // connection, a captive portal, an LLM outage) never fires `online`, and the spec
  // promises offline captures organize themselves without the user's intervention.
  const RETRY_INTERVAL_MS = 60_000;
  let retryTimer: ReturnType<typeof setInterval> | null = null;

  // 5s inactivity → finalize; close → flush. saveAndFinalize always resolves
  // (it catches its own errors), so the autosaver's run never rejects.
  const autosaver = createAutosaver({ save: saveAndFinalize });
  let onBeforeUnload: (() => void) | null = null;
  let onOnline: (() => void) | null = null;

  // The store + hash deps shared by every operation call. Built per call so a
  // settings change between capture and save is picked up.
  function storeDeps() {
    return { db: createRemoteDb(settings), settings, hash: defaultSha1Hex };
  }

  onMount(async () => {
    settings = await loadSettings();
    // beforeunload can't await promises, so flush is best-effort: the Dump was
    // already persisted at capture, so if the close-time save doesn't land the
    // Note is generated from the surviving Dump later (the save-failure path).
    onBeforeUnload = () => {
      if (session && !session.saved) void autosaver.flush();
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    // Reconnect drains the outbox automatically — offline Dumps become Notes with
    // no user intervention. Also drained at startup, for a queue left by a past session.
    onOnline = () => void drain();
    window.addEventListener('online', onOnline);
    await refreshQueueState();
    if (navigator.onLine && queuedCount) void drain();
  });

  onDestroy(() => {
    if (onBeforeUnload) window.removeEventListener('beforeunload', onBeforeUnload);
    if (onOnline) window.removeEventListener('online', onOnline);
    stopRetrying();
    if (session && !session.saved) void autosaver.flush();
  });

  async function captureDump() {
    busy = true;
    status = '';
    try {
      const outcome = await captureOrQueue(text, {
        ...storeDeps(),
        organizer: createOrganizer(settings),
        matcher: createMatcher(settings),
        outbox,
        isOnline: () => navigator.onLine,
        now: () => Date.now(),
        newId: () => crypto.randomUUID(),
      });

      // Queued: the Dump is safe, there is no preview, and no review session opens.
      // A capture that failed while online says so — and names the error — rather
      // than claiming the user is offline.
      if (outcome.kind === 'queued') {
        text = '';
        await refreshQueueState();
        status =
          outcome.reason === 'offline'
            ? `Captured — ${outcome.message}.`
            : `Captured — ${outcome.message}. Capture failed: ${outcome.error?.message}`;
        return;
      }

      session = outcome.session;
      context = '';
      text = '';
      savedNotePath = null;
      appendConfirmed = false;
      // Arm the 5s inactivity timer at capture, so a Dump with no added Context
      // still finalizes on its own. For an 'append' match the autosave no-ops until
      // the user confirms (see saveAndFinalize) — the Dump's Context is still saved.
      autosaver.schedule();
      status = `Captured. Preview: "${session.preview.title}" — ${matchLabel(session)}`;
    } catch (e) {
      status = `Error: ${(e as Error).message}`;
    } finally {
      busy = false;
    }
  }

  // Each Context edit rewrites the Dump (original preserved) and reschedules the 5s
  // inactivity timer. The preview is held — no re-organize per keystroke.
  async function onContextInput() {
    if (!session || session.saved) return;
    try {
      session = await addContext(session, context, storeDeps());
      autosaver.schedule();
    } catch (e) {
      status = `Error: ${(e as Error).message}`;
    }
  }

  async function saveAndFinalize() {
    if (!session || session.saved) return;
    // An 'append' decision is held until the user confirms it (one tap on Append).
    // The autosave may fire on its own for a 'new' decision, but never appends
    // unconfirmed — the Dump's Context is already persisted, so the Note append
    // simply waits for the user.
    if (session.match.kind === 'append' && !appendConfirmed) return;
    try {
      const result = await finalizeCapture(session, {
        ...storeDeps(),
        organizer: createOrganizer(settings),
        now: () => Date.now(),
      });
      session = result.session;
      if (result.ok) {
        savedNotePath = result.written.path;
        status =
          session.match.kind === 'append'
            ? `Appended to: ${session.match.suggestion?.title ?? result.note.title}`
            : `Saved Note: ${result.note.title}`;
      } else {
        // The Dump persists; the Note will be generated from it later.
        status = `Save failed — Dump kept: ${result.error.message}`;
      }
    } catch (e) {
      status = `Error: ${(e as Error).message}`;
    }
  }

  // The one-tap confirm for an append suggestion: mark confirmed, then finalize now.
  async function confirmAppend() {
    if (!session || session.saved) return;
    appendConfirmed = true;
    await autosaver.flush();
  }

  // Override the match decision to 'new' — the user declines the append suggestion
  // and chooses to found a fresh Note instead. Reschedules the autosave.
  function chooseNewNote() {
    if (!session || session.saved) return;
    session = { ...session, match: { kind: 'new' } };
    appendConfirmed = false;
    autosaver.schedule();
    status = 'Will save as a new Note.';
  }

  // Explicit, user-triggered metadata refresh — re-derives title/tags/summary from
  // the saved Note's body. Never automatic; the append itself never refreshes.
  async function refreshMetadata() {
    if (!savedNotePath) return;
    busy = true;
    try {
      await refreshNoteMetadata(savedNotePath, {
        db: createRemoteDb(settings),
        settings,
        organizer: createOrganizer(settings),
        hash: defaultSha1Hex,
        now: () => Date.now(),
      });
      status = `Refreshed metadata: ${savedNotePath}`;
    } catch (e) {
      status = `Refresh failed: ${(e as Error).message}`;
    } finally {
      busy = false;
    }
  }

  // Read the queue and arm or disarm the retry timer to match it. A failure to read
  // the outbox is surfaced, never swallowed to a reassuring zero — the banner exists
  // to tell the user their Dumps are safe, so it must not hide that it can't tell.
  async function refreshQueueState() {
    try {
      queuedCount = (await outbox.list()).length;
      queueError = '';
    } catch (e) {
      queueError = `Could not read the offline queue: ${(e as Error).message}`;
    }
    if (queuedCount) startRetrying();
    else stopRetrying();
  }

  function startRetrying() {
    if (retryTimer) return;
    retryTimer = setInterval(() => void drain(), RETRY_INTERVAL_MS);
  }

  function stopRetrying() {
    if (!retryTimer) return;
    clearInterval(retryTimer);
    retryTimer = null;
  }

  // Sync the queued Dumps to CouchDB and Organize them into Notes. A Dump that
  // fails (the LLM or the connection is still down) stays queued for the next drain.
  async function drain() {
    if (draining) return;
    draining = true;
    try {
      const result = await drainOutbox({
        ...storeDeps(),
        organizer: createOrganizer(settings),
        outbox,
        isOnline: () => navigator.onLine,
      });
      await refreshQueueState();
      if (result.organized.length) {
        status = `Organized ${result.organized.length} queued Dump(s) into Notes.`;
      } else if (result.failed.length) {
        status = `${result.failed.length} queued Dump(s) still waiting: ${result.failed[0].error.message}`;
      }
    } finally {
      draining = false;
    }
  }

  function matchLabel(s: CaptureSession): string {
    return s.match.kind === 'new'
      ? 'new Note'
      : `append to “${s.match.suggestion?.title ?? 'existing'}”`;
  }

  // Retrieve reads the whole vault (personal notes included) and writes nothing —
  // see ADR-0002. v1 re-embeds on every question; there is no persistent index.
  async function askQuestion() {
    asking = true;
    answer = '';
    citations = [];
    try {
      const result = await retrieve(question, {
        ...storeDeps(),
        embedder: createEmbedder(settings),
        answerer: createAnswerer(settings),
      });
      answer = result.answer;
      citations = result.citations;
    } catch (e) {
      status = `Retrieve failed: ${(e as Error).message}`;
    } finally {
      asking = false;
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
    <button class:on={view === 'ask'} on:click={() => (view = 'ask')}>Ask</button>
    <button class:on={view === 'config'} on:click={() => (view = 'config')}>Config</button>
  </nav>

  {#if view === 'capture'}
    {#if queuedCount}
      <p class="queued">{queuedCount} Dump(s) saved — they will be Organized when online.</p>
    {/if}
    {#if queueError}<p class="queued">{queueError}</p>{/if}
    {#if !session}
      <textarea
        bind:value={text}
        placeholder="Dump a thought..."
        disabled={busy}></textarea>
      <button on:click={captureDump} disabled={busy || !text.trim()}>Capture</button>
    {:else}
      <!-- Note preview (the initial Organize) shown alongside the match decision -->
      <section class="preview">
        <h2>{session.preview.title}</h2>
        <p class="match">
          {#if session.match.kind === 'append'}
            Append to “{session.match.suggestion?.title}”
          {:else}
            New Note
          {/if}
        </p>
        <p class="summary">{session.preview.summary}</p>
        {#if session.preview.keyPoints.length}
          <ul>{#each session.preview.keyPoints as p}<li>{p}</li>{/each}</ul>
        {/if}
        {#if session.preview.tags.length}
          <p class="tags">{#each session.preview.tags as t}<span>{t}</span>{/each}</p>
        {/if}
      </section>

      {#if session.match.kind === 'append' && !session.saved}
        <!-- Confirm new-vs-append with one action: keep the append, or override to a new Note -->
        <div class="confirm">
          <button class="primary" on:click={confirmAppend}>Append</button>
          <button on:click={chooseNewNote}>Save as new Note</button>
        </div>
      {/if}

      <label class="context">
        Add Context (preserves your original; saved after 5s idle or on close)
        <textarea bind:value={context} on:input={onContextInput} disabled={session.saved}></textarea>
      </label>

      {#if session.saved}
        <p class="saved">Saved — Dump frozen.</p>
      {/if}
      <button on:click={() => autosaver.flush()} disabled={session.saved}>Save now</button>
      {#if session.saved && savedNotePath}
        <!-- Explicit metadata refresh — never automatic -->
        <button on:click={refreshMetadata} disabled={busy}>Refresh metadata</button>
      {/if}
      <button on:click={() => { session = null; autosaver.cancel(); }}>New capture</button>
    {/if}
  {:else if view === 'ask'}
    <label class="ask">
      Ask your vault
      <textarea bind:value={question} placeholder="What did I think about...?" disabled={asking}
      ></textarea>
    </label>
    <button on:click={askQuestion} disabled={asking || !question.trim()}>Ask</button>
    {#if answer}
      <section class="answer">
        <p>{answer}</p>
        {#if citations.length}
          <h3>Sources</h3>
          <ul>
            {#each citations as c}<li>{c.title} <code>{c.link}</code></li>{/each}
          </ul>
        {/if}
      </section>
    {/if}
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
    <label>Embedder model <input bind:value={settings.embedderModel} placeholder="nomic-embed-text" /></label>
    <button on:click={saveConfig}>Save settings</button>
  {/if}

  {#if status}<p>{status}</p>{/if}
</main>
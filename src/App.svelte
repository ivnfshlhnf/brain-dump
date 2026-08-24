<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { loadSettings, saveSettings } from './lib/settings';
  import { createRemoteDb, createDatabaseAdmin, createEmbeddingsDb } from './lib/db';
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
  import { createOrganizer, createMatcher, createEmbedder, createAnswerer, createRelater } from './lib/llm';
  import { defaultSha1Hex } from './lib/livesync';
  import { createAutosaver } from './lib/autosave';
  import { createLog, createDevFileSink, type Log, type LogEvent } from './lib/logger';
  import { checkConnections, type HealthReport, type CheckResult } from './lib/health';
  import { createCachingEmbedder } from './lib/embedding-cache';
  import { validateProviderUrl } from './lib/config';
  import { DEFAULT_SETTINGS, type Settings, type Citation, type Note } from './lib/types';

  // Diagnostics. In dev the sink POSTs each event to the Vite middleware, which appends
  // it to logs/brain-dump.jsonl in the project folder; in a production build there is no
  // such endpoint and the POSTs simply fail and are swallowed, leaving the in-memory
  // buffer that the Config screen shows.
  const logStore = createLog({ sink: createDevFileSink() });
  // Mirrored into reactive state on every event: `logStore` is a const, so reading it
  // directly from the template would never re-render (this component is in legacy mode,
  // where reactivity comes from assignment).
  let logEvents: LogEvent[] = [];
  const log: Log = (event) => {
    logStore.log(event);
    logEvents = logStore.events();
  };

  // ── The Dump draft: a thought in flight must outlive a closed tab. ──────────
  // Persistence is the cheap, invisible half of "the thought survives, whatever else fails"
  // — the raw Dump has always reached the Vault at Capture, but until that press the typed
  // text lived only in memory. Now it rides in localStorage, restored on the next load.
  const DRAFT_KEY = 'brain-dump:dump-draft';
  let draftTimer: ReturnType<typeof setTimeout> | null = null;

  function readDraft(): string {
    try {
      return localStorage.getItem(DRAFT_KEY) ?? '';
    } catch {
      // Private mode, storage disabled, or quota — degrade to the old behaviour: the
      // draft lives only in memory, which is still no worse than before.
      return '';
    }
  }

  // Debounced: a paste of a long Note shouldn't write on every input event. The latest
  // value is read at fire time, so rapid edits coalesce into one write.
  function persistDraft() {
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      draftTimer = null;
      try {
        localStorage.setItem(DRAFT_KEY, text);
      } catch {
        /* Storage unavailable — nothing to persist, nothing to report. */
      }
    }, 250);
  }

  function clearDraft() {
    if (draftTimer) {
      clearTimeout(draftTimer);
      draftTimer = null;
    }
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* Storage unavailable — the in-memory text is already cleared. */
    }
  }

  let settings: Settings = { ...DEFAULT_SETTINGS };
  // The uncommitted Dump is restored from localStorage on load, so an interrupted thought
  // (a closed tab, a killed app, a bus ride) survives where it used to vanish from volatile
  // memory before the Capture press. Cleared the moment a Dump is captured.
  let text = readDraft();
  let status = '';
  let view: 'capture' | 'ask' | 'config' = 'capture';
  let busy = false;

  // The in-flight capture review session: holds the captured Dump, the initial
  // Organize preview (held while Context is added), and the new-vs-append match.
  let session: CaptureSession | null = null;
  let context = '';
  // The vault path of the last saved Note — used by the explicit Refresh metadata action.
  let savedNotePath: string | null = null;
  // The Note as it was actually written. The card shows this once it exists, so what you
  // look at after the save is the document in the Vault — Related links included — and not
  // the preview that preceded it.
  let savedNote: Note | null = null;
  // Bumped on every Context edit to restart the countdown animation, which is keyed on it.
  let contextRevision = 0;
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
    return { db: createRemoteDb(settings), settings, hash: defaultSha1Hex, log };
  }

  // Autofocus the Dump whenever it mounts — on load (so the first character needs no tap to
  // reach the field) and again after a New capture (so the next thought is one keystroke away).
  // preventScroll keeps desktop from jumping; on mobile the keyboard rising is the point.
  function focusOnMount(node: HTMLElement) {
    node.focus({ preventScroll: true });
  }

  // Cmd/Ctrl+Enter commits the surface you're typing in. The product's thesis is speed at
  // capture; until now no keyboard accelerator existed anywhere in the app.
  function commitOnModEnter(e: KeyboardEvent, run: () => void, disabled: boolean) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!disabled) run();
    }
  }

  onMount(async () => {
    settings = await loadSettings();
    // beforeunload can't await promises, so flush is best-effort: the Dump was
    // already persisted at capture, so if the close-time save doesn't land the
    // Note is generated from the surviving Dump later (the save-failure path).
    onBeforeUnload = () => {
      // Flush the in-flight Note save (best-effort; the Dump is already persisted at capture).
      if (session && !session.saved) void autosaver.flush();
      // And flush the uncommitted draft synchronously — a debounce in flight at close-time
      // would otherwise lose the last 250ms of typing. localStorage writes are synchronous.
      if (draftTimer) {
        clearTimeout(draftTimer);
        draftTimer = null;
        try {
          localStorage.setItem(DRAFT_KEY, text);
        } catch {
          /* Storage unavailable — the in-memory text is gone with the tab. */
        }
      }
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
        organizer: createOrganizer(settings, log),
        matcher: createMatcher(settings, log),
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
        clearDraft();
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
      clearDraft();
      savedNotePath = null;
      savedNote = null;
      contextRevision = 0;
      appendConfirmed = false;
      // Arm the 5s inactivity timer at capture, so a Dump with no added Context
      // still finalizes on its own. For an 'append' match the autosave no-ops until
      // the user confirms (see saveAndFinalize) — the Dump's Context is still saved.
      autosaver.schedule();
      // No status line: the Note is on screen, and the card states its own decision.
      status = '';
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
      contextRevision += 1;
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
        organizer: createOrganizer(settings, log),
        embedder: cachedEmbedder(),
        relater: createRelater(settings, log),
        now: () => Date.now(),
      });
      session = result.session;
      if (result.ok) {
        savedNotePath = result.written.path;
        savedNote = result.note;
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
  // and chooses to found a fresh Note instead. Reschedules the autosave and restarts the
  // countdown edge, which was held while the append waited: now that a save will actually
  // happen on its own, the clock runs honestly from full.
  function chooseNewNote() {
    if (!session || session.saved) return;
    session = { ...session, match: { kind: 'new' } };
    appendConfirmed = false;
    contextRevision += 1;
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
        organizer: createOrganizer(settings, log),
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
        organizer: createOrganizer(settings, log),
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
        embedder: cachedEmbedder(),
        answerer: createAnswerer(settings, log),
      });
      answer = result.answer;
      citations = result.citations;
    } catch (e) {
      status = `Retrieve failed: ${(e as Error).message}`;
    } finally {
      asking = false;
    }
  }

  /** The cloud embedder behind the content-addressed cache (ADR-0004). With no embeddings
   *  database configured the cache is skipped and the cloud embedder is used directly. */
  function cachedEmbedder() {
    return createCachingEmbedder({
      inner: createEmbedder(settings, log),
      store: settings.embeddingsDb.trim() ? createEmbeddingsDb(settings) : undefined,
      settings,
      hash: defaultSha1Hex,
      log,
    });
  }

  async function saveConfig() {
    const problem = validateProviderUrl(settings.llmProvider);
    if (problem) {
      status = problem.message;
      // Both: the code is what a tool matches on, the message is what a human reads.
      log({
        level: 'error',
        op: 'config',
        message: 'settings rejected',
        detail: { problem: problem.code, message: problem.message },
      });
      return;
    }
    await saveSettings(settings);
    status = 'Settings saved';
    log({
      op: 'config',
      message: 'settings saved',
      detail: {
        llmProvider: settings.llmProvider,
        llmModel: settings.llmModel,
        embedderModel: settings.embedderModel,
        couchdbUrl: settings.couchdbUrl,
        couchdbDb: settings.couchdbDb,
        managedFolder: settings.managedFolder,
        hasApiKey: Boolean(settings.llmApiKey),
      },
    });
  }

  let health: HealthReport | null = null;
  let testing = false;

  async function testConnections() {
    testing = true;
    health = null;
    status = '';
    try {
      health = await checkConnections({
        db: createRemoteDb(settings),
        organizer: createOrganizer(settings, log),
        embedder: createEmbedder(settings, log),
        admin: createDatabaseAdmin(settings),
        settings,
        log,
      });
    } catch (e) {
      status = `Could not run the connection test: ${(e as Error).message}`;
    } finally {
      testing = false;
    }
  }

  /** The report as labelled rows. A tuple literal in the template widens to
   *  `string | CheckResult`, so the shape is named here instead. */
  function healthRows(r: HealthReport): Array<{ name: string; result: CheckResult }> {
    return [
      { name: 'CouchDB', result: r.couchdb },
      { name: 'Chat', result: r.chat },
      { name: 'Embeddings', result: r.embeddings },
      ...(r.databaseCreation ? [{ name: 'Database creation', result: r.databaseCreation }] : []),
    ];
  }

  function copyDiagnostics() {
    void navigator.clipboard?.writeText(logStore.format());
    status = 'Diagnostics copied';
  }
</script>

<main>
  <header class="masthead">
    <span class="wordmark">brain-dump</span>
    <nav>
      <button class:on={view === 'capture'} on:click={() => (view = 'capture')}>capture</button>
      <button class:on={view === 'ask'} on:click={() => (view = 'ask')}>ask</button>
      <button class:on={view === 'config'} on:click={() => (view = 'config')}>config</button>
    </nav>
  </header>

  {#if view === 'capture'}
    {#if queuedCount}
      <p class="status">{queuedCount} Dump(s) saved — they will be Organized when online.</p>
    {/if}
    {#if queueError}<p class="status err">{queueError}</p>{/if}

    {#if !session}
      <!-- The Dump is the product, not a form field: set in the content face, at content size. -->
      <textarea
        class="dump"
        use:focusOnMount
        bind:value={text}
        on:input={persistDraft}
        on:keydown={(e) => commitOnModEnter(e, captureDump, busy || !text.trim())}
        placeholder="What are you thinking?"
        disabled={busy}></textarea>
      <div class="actions">
        <button class="primary" on:click={captureDump} disabled={busy || !text.trim()}>Capture</button>
      </div>
    {:else}
      {@const shown = savedNote ?? session.preview}
      <!-- The whole Note, not a summary of it. Before the save this is the preview; after it
           this is the document in the Vault. You are approving a Note, so you are shown one. -->
      <article class="note" class:committed={session.saved}>
        {#key contextRevision}
          <div class="burn" class:burn--held={session.match.kind === 'append' && !appendConfirmed}></div>
        {/key}

        <p class="eyebrow">
          {#if session.saved && savedNotePath}
            {savedNotePath}
          {:else}
            {matchLabel(session)}
          {/if}
        </p>

        <h2>{shown.title}</h2>

        <dl class="meta">
          {#if shown.tags.length}
            <dt>tags</dt>
            <dd>{shown.tags.join('  ')}</dd>
          {/if}
          {#if shown.category}
            <dt>category</dt>
            <dd>{shown.category}</dd>
          {/if}
        </dl>

        {#if shown.body}
          <div class="note-body">{shown.body}</div>
        {/if}

        {#if shown.summary}
          <p class="rule-label">summary</p>
          <p>{shown.summary}</p>
        {/if}

        {#if shown.keyPoints.length}
          <p class="rule-label">key points</p>
          <ul>{#each shown.keyPoints as point}<li>{point}</li>{/each}</ul>
        {/if}

        <p class="rule-label">related</p>
        {#if shown.related.length}
          <ul class="links">{#each shown.related as link}<li>{link}</li>{/each}</ul>
        {:else if session.saved}
          <p class="pending">No Note in the Vault was close enough to link.</p>
        {:else}
          <p class="pending">Links are found when the Note is saved.</p>
        {/if}
      </article>

      {#if session.match.kind === 'append' && !session.saved}
        <!-- Confirm new-vs-append with one action: keep the append, or override to a new Note -->
        <div class="actions">
          <button class="primary" on:click={confirmAppend}>Append</button>
          <button on:click={chooseNewNote}>Save as new Note</button>
        </div>
      {/if}

      <label class="context-field">
        add context
        <textarea
          bind:value={context}
          on:input={onContextInput}
          on:keydown={(e) => commitOnModEnter(
            e,
            () => autosaver.flush(),
            // The context field only renders with a session; the !session guard is for the
            // type checker, not the runtime — it makes an absent session a no-op rather than
            // a null deref. Matches the "Save now" visibility rule from the harden pass.
            !session || session.saved || (session.match.kind === 'append' && !appendConfirmed),
          )}
          disabled={session.saved}></textarea>
      </label>
      <p class="hint">
        {#if session.saved}
          Dump frozen. Your verbatim original is kept inside it.
        {:else if session.match.kind === 'append' && !appendConfirmed}
          Append waits for your confirmation — it won’t save on its own. Your verbatim original is kept.
        {:else}
          Saves 5 seconds after you stop typing. Your verbatim original is kept.
        {/if}
      </p>

      <div class="actions">
        {#if session.match.kind !== 'append' || appendConfirmed}
          <!-- "Save now" forces the autosave. It is only honest where a save will actually
               happen — an unconfirmed append no-ops, so on that path the decision buttons
               above (Append / Save as new Note) are the save, and this one is absent. -->
          <button on:click={() => autosaver.flush()} disabled={session.saved}>Save now</button>
        {/if}
        {#if session.saved && savedNotePath}
          <!-- Explicit metadata refresh — never automatic -->
          <button on:click={refreshMetadata} disabled={busy}>Refresh metadata</button>
        {/if}
        <button on:click={() => { session = null; savedNote = null; autosaver.cancel(); }}>New capture</button>
      </div>
    {/if}
  {:else if view === 'ask'}
    <label class="ask">
      ask your vault
      <textarea
        bind:value={question}
        on:keydown={(e) => commitOnModEnter(e, askQuestion, asking || !question.trim())}
        placeholder="What did I think about..."
        disabled={asking}></textarea>
    </label>
    <div class="actions">
      <button class="primary" on:click={askQuestion} disabled={asking || !question.trim()}>
        {asking ? 'Reading your vault…' : 'Ask'}
      </button>
    </div>
    {#if answer}
      <section class="answer">
        <p>{answer}</p>
        {#if citations.length}
          <p class="rule-label">sources</p>
          <ul class="sources">
            {#each citations as c}<li>{c.title} — {c.link}</li>{/each}
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
    <label>Embeddings database <input bind:value={settings.embeddingsDb} /></label>
    <label>Case-sensitive <input type="checkbox" bind:checked={settings.caseSensitive} /></label>
    <label>LLM provider <input bind:value={settings.llmProvider} /></label>
    <label>LLM model <input bind:value={settings.llmModel} /></label>
    <label>LLM API key <input type="password" bind:value={settings.llmApiKey} /></label>
    <label>Embedder model <input bind:value={settings.embedderModel} /></label>
    <div class="actions">
      <button class="primary" on:click={saveConfig}>Save settings</button>
    </div>

    <p class="rule-label">connection</p>
    <p class="hint">
      Checks CouchDB, the chat model, and the embedder independently, so a failure points at
      one field. The chat and embedder checks each make one small real request and
      <strong>spend LLM credit</strong> — a fraction of a cent per press. It also creates and
      immediately removes a throwaway database, to find out whether your CouchDB account may
      create one at all.
    </p>
    <div class="actions">
      <button on:click={testConnections} disabled={testing}>
        {testing ? 'Testing…' : 'Test connection'}
      </button>
    </div>
    {#if health}
      <ul class="checks">
        {#each healthRows(health) as row}
          <li class:err={!row.result.ok}>
            {row.result.ok ? '✓' : '✗'} <strong>{row.name}</strong> — {row.result.message}
          </li>
        {/each}
      </ul>
    {/if}

    <p class="rule-label">diagnostics</p>
    <p class="hint">
      The last {logEvents.length} events, newest first. In dev these are also appended to
      <code>logs/brain-dump.jsonl</code> in the project folder.
    </p>
    <div class="actions">
      <button on:click={copyDiagnostics}>Copy diagnostics</button>
      <button on:click={() => { logStore.clear(); logEvents = []; status = 'Diagnostics cleared'; }}>Clear</button>
    </div>
    <ul class="diagnostics">
      {#each logEvents.slice().reverse() as e}
        <li class:err={e.level === 'error'}>
          <code>{new Date(e.at).toLocaleTimeString()}</code>
          <strong>{e.op}</strong>
          {e.message}
          {#if e.detail}<code class="detail">{JSON.stringify(e.detail)}</code>{/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#if status}<p class="status">{status}</p>{/if}
</main>

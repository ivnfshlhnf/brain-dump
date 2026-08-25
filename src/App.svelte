<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { loadSettings, saveSettings } from './lib/settings';
  import { createRemoteDb, createDatabaseAdmin, createEmbeddingsDb } from './lib/db';
  import {
    captureThought,
    addContext,
    finalizeCapture,
    refreshNoteMetadata,
    recoverPending,
    adoptInterrupted,
    retryPending,
    findStrandedDumps,
    restoreStranded,
    organizeDump,
    dumpPath,
    isStranded,
    type CaptureSession,
  } from './lib/operations';
  import { createIndexedDbPendingStore } from './lib/pending';
  import { createIndexedDbDismissedStore } from './lib/dismissed';
  import { retrieve } from './lib/retrieve';
  import { createOrganizer, createMatcher, createEmbedder, createAnswerer, createRelater } from './lib/llm';
  import { defaultSha1Hex } from './lib/livesync';
  import { createAutosaver } from './lib/autosave';
  import { createLog, createDevFileSink, type Log, type LogEvent } from './lib/logger';
  import { obsidianUrl, linkHref, linkText } from './lib/obsidian';
  import { checkConnections, type HealthReport, type CheckResult } from './lib/health';
  import { createCachingEmbedder } from './lib/embedding-cache';
  import { validateProviderUrl } from './lib/config';
  import {
    DEFAULT_SETTINGS,
    type Settings,
    type Citation,
    type Dump,
    type Note,
    type PendingDump,
    type StrandedDump,
  } from './lib/types';

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
  // The vault path of the last saved Note — used by the explicit Re-organize Note action.
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

  // The durable record of every Dump that still needs Organizing. A Capture enrols here
  // before anything can fail and leaves only once its Note exists, so an interruption
  // cannot strand a thought silently the way it did four times in finding 02.
  const pending = createIndexedDbPendingStore();
  let pendingRecords: PendingDump[] = [];
  let pendingError = '';
  let recovering = false;
  // Vault reconciliation (Config): the Dumps no Note cites, found by asking the Vault
  // rather than this device's Pending store. Manual — see the hint beside the button.
  const dismissed = createIndexedDbDismissedStore();
  let strandedInVault: StrandedDump[] = [];
  let reconciled = false;
  let reconciling = false;
  let organizingStranded = '';
  // While Dumps are Pending, retry on a timer as well as on the `online` event: a
  // capture that failed while `navigator.onLine` was already true (a flaky
  // connection, a captive portal, an LLM outage) never fires `online`, and the spec
  // promises offline captures organize themselves without the user's intervention.
  const RETRY_INTERVAL_MS = 60_000;
  let retryTimer: ReturnType<typeof setInterval> | null = null;

  // The banner speaks for the records rather than a single counter. A generic "waiting"
  // would reintroduce the exact ambiguity that made the user press Capture three times:
  // they could not tell working from nothing-happening.
  $: openSessionId = session && !session.saved ? session.dump.id : null;
  // The Dump on screen is the session's business, not the banner's — its Note is about
  // to be written by the review flow itself.
  $: bannerRecords = pendingRecords.filter((r) => r.dump.id !== openSessionId);
  $: strandedRecords = bannerRecords.filter(isStranded);
  $: liveRecords = bannerRecords.filter((r) => !isStranded(r));
  $: offlineCount = liveRecords.filter((r) => r.reason === 'offline').length;
  $: inFlightCount = liveRecords.filter((r) => r.reason === 'in-flight').length;
  // Only the ones a *past* session left behind. A Dump that failed a minute ago in this
  // session is backing off, which is a different thing and says so below.
  $: recoveringCount = liveRecords.filter((r) => r.reason === 'interrupted').length;
  $: retryingCount = liveRecords.filter((r) => r.reason === 'failed').length;

  /** The first line of a Dump, for a list that has to say *which thought* this is. */
  function firstLine(content: string): string {
    const line = content.trim().split('\n')[0];
    return line.length > 80 ? `${line.slice(0, 79)}…` : line;
  }

  // 5s inactivity → finalize; close → flush. saveAndFinalize always resolves
  // (it catches its own errors), so the autosaver's run never rejects.
  const autosaver = createAutosaver({ save: saveAndFinalize });
  let onBeforeUnload: (() => void) | null = null;
  let onOnline: (() => void) | null = null;

  // The store + hash deps shared by every operation call. Built per call so a
  // settings change between capture and save is picked up.
  function storeDeps() {
    return { db: createRemoteDb(settings), settings, hash: defaultSha1Hex, log, pending };
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

  // On save the commit is promoted onto the card itself (the teal edge plus the "Filed to
  // Obsidian" line). Bring the card to the top of the viewport so the peak-end frame is the
  // filed Note, not the bottom-of-page status line that just scrolled past. Smooth, unless the
  // user has asked motion to stop.
  function scrollToNote() {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.querySelector('.note')?.scrollIntoView({
      behavior: reduce ? 'auto' : 'smooth',
      block: 'start',
    });
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

    // Reconnect recovers Pending Dumps automatically — they become Notes with no user
    // intervention, which is the promise: you do not file anything, the app files
    // everything it took.
    onOnline = () => void recover();
    window.addEventListener('online', onOnline);
    // Anything still marked in-flight belongs to a session that ended — nothing survived
    // this reload that could still be organizing it. Done once, at start, never on the
    // retry timer, which runs while a capture may genuinely be in flight.
    await adoptInterrupted(pending, log);
    await refreshPending();
    // Read the records, not the derived `liveRecords`: reactive statements have not
    // recomputed yet at this point in the same tick.
    if (navigator.onLine && pendingRecords.some((r) => !isStranded(r))) void recover();
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
      const outcome = await captureThought(text, {
        ...storeDeps(),
        organizer: createOrganizer(settings, log),
        matcher: createMatcher(settings, log),
        isOnline: () => navigator.onLine,
        now: () => Date.now(),
        newId: () => crypto.randomUUID(),
        // The instant the Dump is durably Pending it is the app's responsibility. Empty
        // the box then and there: text still sitting in it after a press that appears to
        // do nothing is an invitation to press again, which is how three byte-identical
        // Dumps reached the Vault 55 seconds apart.
        onPending: () => {
          text = '';
          clearDraft();
          void refreshPending();
        },
      });

      // Pending with no preview: the Dump is safe and no review session opens. A capture
      // that failed while online says so — and names the error — rather than claiming the
      // user is offline.
      if (outcome.kind === 'pending') {
        await refreshPending();
        status =
          outcome.reason === 'offline'
            ? `Captured — ${outcome.message}.`
            : `Captured — ${outcome.message}. Capture failed: ${outcome.error?.message}`;
        return;
      }

      session = outcome.session;
      context = '';
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
      await refreshPending();
      if (result.ok) {
        savedNotePath = result.written.path;
        savedNote = result.note;
        status =
          session.match.kind === 'append'
            ? `Appended to: ${session.match.suggestion?.title ?? result.note.title}`
            : `Saved Note: ${result.note.title}`;
        // The commit now lives on the card (teal edge + "Filed to Obsidian" line); bring it
        // into view so the last frame is the filed Note, not the status line that scrolled past.
        await tick();
        scrollToNote();
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

  // Explicit, user-triggered re-organize — re-runs Organize on the saved Note's body to
  // re-derive its title/tags/summary/category. Never automatic; the append itself never
  // refreshes. (The button reads "Re-organize Note"; "metadata" is the internal name only.)
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
      status = `Re-organized: ${savedNotePath}`;
    } catch (e) {
      status = `Re-organize failed: ${(e as Error).message}`;
    } finally {
      busy = false;
    }
  }

  // Read the Pending records and arm or disarm the retry timer to match them. A failure
  // to read is surfaced, never swallowed to a reassuring zero — the banner exists to tell
  // the user their Dumps are safe, so it must not hide that it cannot tell.
  async function refreshPending() {
    try {
      pendingRecords = await pending.list();
      pendingError = '';
    } catch (e) {
      pendingError = `Could not read the Pending Dumps: ${(e as Error).message}`;
    }
    // A Stranded Dump is not retried on a timer: the app has stopped, and says so.
    if (pendingRecords.some((r) => !isStranded(r))) startRetrying();
    else stopRetrying();
  }

  function startRetrying() {
    if (retryTimer) return;
    retryTimer = setInterval(() => void recover(), RETRY_INTERVAL_MS);
  }

  function stopRetrying() {
    if (!retryTimer) return;
    clearInterval(retryTimer);
    retryTimer = null;
  }

  // Sync the Pending Dumps to CouchDB and Organize them into Notes. A Dump that fails
  // (the LLM or the connection is still down) stays Pending for the next attempt, and
  // after the attempt cap it becomes Stranded and stops costing calls.
  async function recover() {
    if (recovering) return;
    recovering = true;
    try {
      const result = await recoverPending({
        ...storeDeps(),
        organizer: createOrganizer(settings, log),
        isOnline: () => navigator.onLine,
        now: () => Date.now(),
        // Never race the review flow into a second Note for the Dump on screen.
        exclude: session && !session.saved ? [session.dump.id] : [],
      });
      await refreshPending();
      if (result.organized.length) {
        const n = result.organized.length;
        status = n === 1
          ? `Organized 1 Dump into a Note.`
          : `Organized ${n} Dumps into Notes.`;
      } else if (result.failed.length) {
        const n = result.failed.length;
        status = `${n} ${n === 1 ? 'Dump is' : 'Dumps are'} still waiting: ${result.failed[0].error.message}`;
      }
    } finally {
      recovering = false;
    }
  }

  /** Arm the Stranded Dumps for another attempt and run it now. The user asking is new
   *  information: they have usually just fixed whatever was broken. */
  async function retryStranded(ids?: string[]) {
    await retryPending(pending, ids);
    await refreshPending();
    await recover();
  }

  /** Ask the Vault, not this device: which Dumps does no Note cite? Manual, because a
   *  scan that Organized on its own would spend LLM calls on old thoughts unasked. */
  async function findStranded() {
    reconciling = true;
    try {
      strandedInVault = await findStrandedDumps({ ...storeDeps(), dismissed });
      reconciled = true;
      status = strandedInVault.length
        ? `${strandedInVault.length} stranded ${strandedInVault.length === 1 ? 'Dump' : 'Dumps'} in the Vault.`
        : 'Every Dump in the Vault is filed.';
    } catch (e) {
      status = `Could not read the Vault: ${(e as Error).message}`;
    } finally {
      reconciling = false;
    }
  }

  /** Organize one Dump found by reconciliation. It founds a new Note: an unattended
   *  Organize has nobody to confirm an Append with. */
  async function organizeStranded(dump: Dump) {
    organizingStranded = dump.id;
    try {
      const result = await organizeDump(dump, { ...storeDeps(), organizer: createOrganizer(settings, log) });
      strandedInVault = strandedInVault.filter((s) => s.dump.id !== dump.id);
      status = `Saved Note: ${result.note.title}`;
    } catch (e) {
      status = `Could not Organize that Dump: ${(e as Error).message}`;
    } finally {
      organizingStranded = '';
    }
  }

  /** Bring back what was deleted. The documents kept their content, so this costs no LLM
   *  call and returns the Note that existed — edits included — rather than a new one. */
  async function restoreDeleted(stranded: StrandedDump) {
    organizingStranded = stranded.dump.id;
    try {
      await restoreStranded(stranded, storeDeps());
      strandedInVault = strandedInVault.filter((s) => s.dump.id !== stranded.dump.id);
      status = 'Restored.';
    } catch (e) {
      status = `Could not restore: ${(e as Error).message}`;
    } finally {
      organizingStranded = '';
    }
  }

  /** "Stop telling me about this." Writes nothing to the Vault — the Dump stays exactly
   *  where it is, and deleting it for real is one tap in Obsidian. */
  async function dismissStranded(stranded: StrandedDump) {
    try {
      await dismissed.dismiss(stranded.dump.id);
      strandedInVault = strandedInVault.filter((s) => s.dump.id !== stranded.dump.id);
      status = 'Dismissed — the Dump is untouched in your Vault.';
    } catch (e) {
      status = `Could not dismiss: ${(e as Error).message}`;
    }
  }

  /** Only the ones Organize applies to: a deleted document wants restoring, not a new Note. */
  $: unfiledStranded = strandedInVault.filter((s) => s.reason === 'unfiled');

  async function organizeAllStranded() {
    for (const s of unfiledStranded.slice()) await organizeStranded(s.dump);
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

<!-- The masthead is a sibling of <main>, not a child of it: a <header> only becomes a `banner`
     landmark when nothing like <main> stands between it and the body, so nesting it cost the
     page its one other landmark. The wrapper div carries the column. -->
<div class="page">
  <header class="masthead">
    <h1 class="wordmark">brain-dump</h1>
    <nav>
      <button
        class:on={view === 'capture'}
        aria-current={view === 'capture' ? 'page' : undefined}
        on:click={() => (view = 'capture')}>capture</button>
      <button
        class:on={view === 'ask'}
        aria-current={view === 'ask' ? 'page' : undefined}
        on:click={() => (view = 'ask')}>ask</button>
      <button
        class:on={view === 'config'}
        aria-current={view === 'config' ? 'page' : undefined}
        on:click={() => (view = 'config')}>settings</button>
    </nav>
  </header>

  <main>
  {#if view === 'capture'}
    <section class="surface">
    <!-- Four states, kept distinct on purpose. Collapsing them into one "waiting" line
         would restore the ambiguity that caused finding 02: the user could not tell a
         Dump being worked on from one nothing was happening to. Stranded outranks the
         rest — it is the app admitting it broke its promise. -->
    {#if strandedRecords.length}
      <p class="status err" aria-live="polite">
        {strandedRecords.length === 1
          ? "1 Dump couldn't be Organized"
          : `${strandedRecords.length} Dumps couldn't be Organized`}: {strandedRecords[0].lastError}
      </p>
      <div class="actions"><button on:click={() => retryStranded()}>Retry</button></div>
    {:else if recoveringCount}
      <p class="status" aria-live="polite">
        Organizing {recoveringCount === 1 ? '1 Dump' : `${recoveringCount} Dumps`} left from your last session…
      </p>
    {:else if retryingCount}
      <p class="status" aria-live="polite">
        {retryingCount === 1 ? "1 Dump couldn't be Organized" : `${retryingCount} Dumps couldn't be Organized`} —
        trying again shortly.
      </p>
    {:else if offlineCount}
      <p class="status" aria-live="polite">
        {offlineCount === 1
          ? '1 Dump saved — it will be Organized'
          : `${offlineCount} Dumps saved — they will be Organized`} when you're back online.
      </p>
    {:else if inFlightCount}
      <p class="status" aria-live="polite">Organizing your Dump…</p>
    {/if}
    {#if pendingError}<p class="status err" aria-live="polite">{pendingError}</p>{/if}

    {#if !session}
      <!-- The Dump is the product, not a form field: set in the content face, at content size,
           and named for assistive tech without a visible label — a label above it would make
           it a form control, which is the one thing it must not look like. Every other field
           in the app carries its label on screen; this one carries it in the name. -->
      <textarea
        class="dump"
        use:focusOnMount
        bind:value={text}
        on:input={persistDraft}
        on:keydown={(e) => commitOnModEnter(e, captureDump, busy || !text.trim())}
        aria-label="Dump — what are you thinking?"
        placeholder="What are you thinking?"
        disabled={busy}></textarea>
      <div class="actions">
        <button class="primary" on:click={captureDump} disabled={busy || !text.trim()}>
          {busy ? 'Capturing…' : 'Capture'}
        </button>
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
            <span class="filed-mark">Filed to Obsidian</span><br>
            <a class="vault-link" href={obsidianUrl(settings.vaultName, savedNotePath)}>{savedNotePath}</a>
          {:else if session.match.kind === 'new'}
            New Note
          {:else}
            Append to <span class="keep-case">&ldquo;{session.match.suggestion?.title ?? 'an existing Note'}&rdquo;</span>
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
          <ul class="links">{#each shown.related as link}<li><a class="vault-link" href={linkHref(settings.vaultName, link)}>{linkText(link)}</a></li>{/each}</ul>
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
          <!-- Explicit re-organize — never automatic -->
          <button on:click={refreshMetadata} disabled={busy}>Re-organize Note</button>
        {/if}
        <button on:click={() => { session = null; savedNote = null; autosaver.cancel(); }}>New capture</button>
      </div>
    {/if}
    </section>
  {:else if view === 'ask'}
    <section class="surface">
    <label class="ask">
      ask your vault
      <textarea
        bind:value={question}
        on:keydown={(e) => commitOnModEnter(e, askQuestion, asking || !question.trim())}
        placeholder="What did I think about…"
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
            {#each citations as c}<li><a class="vault-link" href={obsidianUrl(settings.vaultName, c.path)}>{c.title}</a></li>{/each}
          </ul>
        {/if}
      </section>
    {/if}
    </section>
  {:else}
    <section class="surface">
    <!-- Twelve fields are two decisions: where the notes live, and which model does the
         work. Grouped under the same ruled labels the rest of this surface already uses. -->
    <fieldset class="field-group">
      <legend class="rule-label">vault</legend>
      <label>CouchDB URL <input bind:value={settings.couchdbUrl} placeholder="http://localhost:5984" /></label>
      <label>Database <input bind:value={settings.couchdbDb} placeholder="obsidiannotes" /></label>
      <label>Username <input bind:value={settings.couchdbUser} /></label>
      <label>Password <input type="password" bind:value={settings.couchdbPassword} /></label>
      <label>Managed folder <input bind:value={settings.managedFolder} /></label>
      <label>Obsidian vault name <input bind:value={settings.vaultName} placeholder="your vault, on this device" /></label>
      <label>Case-sensitive file names <input type="checkbox" bind:checked={settings.caseSensitive} /></label>
    </fieldset>

    <fieldset class="field-group">
      <legend class="rule-label">model</legend>
      <label>LLM provider <input bind:value={settings.llmProvider} /></label>
      <label>LLM model <input bind:value={settings.llmModel} /></label>
      <label>LLM API key <input type="password" bind:value={settings.llmApiKey} /></label>
      <label>Embedder model <input bind:value={settings.embedderModel} /></label>
      <label>Embeddings database <input bind:value={settings.embeddingsDb} /></label>
    </fieldset>

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
            <!-- Drawn, not typed: a ✓/✗ character pair borrows whatever the system font
                 draws and belongs to no part of this design. The word beside it carries the
                 result for anyone the colour and the mark do not reach. -->
            <svg class="check-mark" viewBox="0 0 16 16" aria-hidden="true">
              {#if row.result.ok}
                <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
              {:else}
                <path d="M4.5 4.5 11.5 11.5 M11.5 4.5 4.5 11.5" />
              {/if}
            </svg>
            <span><span class="sr-only">{row.result.ok ? 'Passed:' : 'Failed:'}</span>
              <strong>{row.name}</strong> — {row.result.message}</span>
          </li>
        {/each}
      </ul>
    {/if}

    <p class="rule-label">stranded dumps</p>
    <p class="hint">
      A Stranded Dump reached the Vault but never became a Note. The app retries the ones it
      knows about on its own; this asks the <strong>Vault</strong> instead, which is the only
      thing that knows about Dumps captured on another device or before this check existed.
      Organizing one makes a real request and <strong>spends LLM credit</strong>. Restoring a
      deleted document costs nothing — the content was never gone, only marked — and brings
      back the Note that existed rather than writing a new one. Dismiss writes nothing to the
      Vault: it only stops this list mentioning the Dump again.
    </p>
    {#if strandedRecords.length}
      <ul class="stranded">
        {#each strandedRecords as r (r.dump.id)}
          <li class="err">
            <!-- The timestamp is the way into the Vault: reading the thought is how you
                 decide whether you still want it Organized at all. -->
            <a class="vault-link stranded-when" href={obsidianUrl(settings.vaultName, dumpPath(r.dump, settings))}>
              {new Date(r.dump.createdAt).toLocaleString()}
            </a>
            <span class="stranded-text">{firstLine(r.dump.content)}<br /><span class="detail">{r.lastError}</span></span>
            <button on:click={() => retryStranded([r.dump.id])}>Retry</button>
          </li>
        {/each}
      </ul>
    {/if}
    <div class="actions">
      <button on:click={findStranded} disabled={reconciling}>
        {reconciling ? 'Reading the Vault…' : 'Find stranded Dumps'}
      </button>
      {#if unfiledStranded.length > 1}
        <button on:click={organizeAllStranded} disabled={!!organizingStranded}>
          Organize all {unfiledStranded.length}
        </button>
      {/if}
    </div>
    {#if reconciled}
      {#if strandedInVault.length}
        <!-- Which thought, not just how many: "1 Dump couldn't be Organized" is a
             notification you cannot act on. The link opens the Dump in Obsidian, so the
             answer to "do I still care about this?" is one tap away. -->
        <!-- One list, three states. They are one question — which of my thoughts are not
             in my Vault? — so splitting them would make you look in two places to answer
             it. Each row says which state it is in and offers only the action that fits:
             a Dump nobody ever filed wants Organize, a deleted one wants its document
             back. -->
        <ul class="stranded">
          {#each strandedInVault as s (s.dump.id)}
            <li>
              <a class="vault-link stranded-when" href={obsidianUrl(settings.vaultName, dumpPath(s.dump, settings))}>
                {new Date(s.dump.createdAt).toLocaleString()}
              </a>
              <span class="stranded-text">
                {firstLine(s.dump.content)}
                <br />
                <span class="detail">
                  {#if s.reason === 'unfiled'}
                    never became a Note
                  {:else if s.reason === 'note-deleted'}
                    its Note was deleted — {s.notePath}
                  {:else if s.reason === 'note-unreadable'}
                    its Note exists but Obsidian will not write it — {s.notePath}
                  {:else}
                    the Dump and its Note were both deleted
                  {/if}
                </span>
              </span>
              {#if s.reason === 'unfiled'}
                <button on:click={() => organizeStranded(s.dump)} disabled={!!organizingStranded}>
                  {organizingStranded === s.dump.id ? 'Organizing…' : 'Organize'}
                </button>
              {:else}
                <button on:click={() => restoreDeleted(s)} disabled={!!organizingStranded}>
                  {#if organizingStranded === s.dump.id}
                    {s.reason === 'note-unreadable' ? 'Repairing…' : 'Restoring…'}
                  {:else}
                    {s.reason === 'note-unreadable' ? 'Repair' : 'Restore'}
                  {/if}
                </button>
              {/if}
              <button on:click={() => dismissStranded(s)} disabled={!!organizingStranded}>Dismiss</button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="hint">Every Dump in the Vault is filed.</p>
      {/if}
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
    </section>
  {/if}

  {#if status}<p class="status" aria-live="polite">{status}</p>{/if}
  </main>
</div>

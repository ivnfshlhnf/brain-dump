<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { loadSettings, saveSettings } from './lib/settings';
  import { createRemoteDb, createDatabaseAdmin, createEmbeddingsDb } from './lib/db';
  import {
    captureThought,
    addContext,
    finalizeCapture,
    recoverPending,
    adoptInterrupted,
    retryPending,
    findStrandedDumps,
    restoreStranded,
    organizeDump,
    dumpPath,
    isStranded,
    readGrid,
    fileOnGrid,
    readNote,
    reorganizeNote,
    citedCards,
    type CaptureSession,
    type NoteView,
  } from './lib/operations';
  import { createIndexedDbPendingStore } from './lib/pending';
  import { createIndexedDbDismissedStore } from './lib/dismissed';
  import { createIndexedDbCardCache } from './lib/card-cache';
  import { hueFor, type Category } from './lib/category';
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
    type Dump,
    type NoteCard,
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
  // The grid is the persistent surface and Capture, Note and Ask are sheets over it (tickets
  // 05–07). Settings is still a view beside the grid; ticket 08 turns it into a sheet too and
  // ticket 10 takes the nav with it.
  let view: 'config' | 'grid' = 'grid';
  // The one open sheet, or none. Sheets do not nest, so this is a single value and not a
  // stack: a sheet is a place you drop into from the grid and return from.
  let sheet: 'capture' | 'note' | 'ask' | null = null;
  let busy = false;

  // The Note sheet (ticket 06): the whole Note a card opens onto, read live from the Vault —
  // the dry twin of the pre-commit preview, at full length — plus the verbatim source Dump.
  let noteView: NoteView | null = null;
  let noteLoading = false;
  let reorganizing = false;

  // The in-flight capture review session: holds the captured Dump, the initial
  // Organize preview (held while Context is added), and the new-vs-append match.
  let session: CaptureSession | null = null;
  let context = '';
  // Hold: the user pressed a button specifically to stop the clock, so nothing may start it
  // again behind them. It is the autosaver's existing `cancel` plus this flag — the autosave
  // module gains no interface for it — and the only exit is the user explicitly filing.
  let held = false;
  // Bumped on every Context edit to restart the countdown animation, which is keyed on it.
  // Never bumped while Held: restarting the animation would draw a clock that is not running.
  let contextRevision = 0;
  // Append requires explicit user confirmation (spec: "the user confirms … with one
  // action"). The 5s autosave may finalize a 'new' decision on its own, but an 'append'
  // decision is held until the user taps Append — so the autosave no-ops an
  // unconfirmed append rather than silently appending.
  let appendConfirmed = false;
  // Retrieve: a question over the whole vault, and the answer with its citations. The citations
  // are shown as the same cards the grid shows (ticket 07), so the answer's sources are
  // tappable into the Note sheet — `askCards` is that projection, built once per answer.
  let question = '';
  let answer = '';
  let askCards: NoteCard[] = [];
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
  // The home grid (ticket 02). The grid is the road to capture, so the card read must never
  // gate the Capture control: it paints from a device-local cache and reconciles behind it
  // (ADR-0007). A cold, failed or empty cache shows the Capture control and an empty grid.
  const cardCache = createIndexedDbCardCache();
  let cards: NoteCard[] = [];
  let cardsLoaded = false;
  // The Vault is empty once the card cache has settled with nothing in it — the proxy Ask dims
  // against, since retrieve can't answer from Notes that aren't there. One concept, named once.
  $: vaultIsEmpty = cardsLoaded && cards.length === 0;
  // The card of the Note just filed. It slots into the grid wearing the `set` ring — the
  // receipt for a commit is the thing itself arriving, not a message about it — and goes
  // quiet again shortly after, leaving nothing behind.
  const WET_MS = 3000;
  let wetPath: string | null = null;
  let wetTimer: ReturnType<typeof setTimeout> | null = null;
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

  /** The inline `--cat-hue` custom property for a card, or '' when the Category carries no hue
   *  (`uncategorized` — the absence of a Category is not a colour). The CSS colours the left edge
   *  and chip only on `.card--cat`, which the template adds precisely when `hueFor` is non-null. */
  function hueStyle(category: Category): string {
    const h = hueFor(category);
    return h !== null ? `--cat-hue:${h}` : '';
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

  /** Open the grid: one Vault pass yields the Note cards AND the Stranded Dumps (ADR-0007), so
   *  reconciliation is a property of opening the grid, not a button. The cache paints the cards
   *  it holds before the pass completes — so the grid shows something at once and stays populated
   *  even when the Vault is slow or unreachable — and the pass then reconciles both. The Capture
   *  control renders regardless of how far this has got — capture friction is the one unforgivable
   *  failure. */
  async function enterGrid() {
    try {
      const result = await readGrid(
        { ...storeDeps(), cache: cardCache, pending, dismissed },
        (cached) => {
          // Paint the cached cards before the Vault read completes.
          cards = cached;
        },
      );
      cards = result.cards;
      strandedInVault = result.stranded;
    } catch {
      // A Vault read failure leaves whatever was painted; the grid stays usable.
    }
    cardsLoaded = true;
  }

  // A sheet is a native modal <dialog> opened with showModal(), so the platform supplies what
  // a sheet has to have and this component does not hand-roll: the grid behind it goes inert
  // (top layer), focus is trapped inside, and every platform close request — Esc, the phone's
  // back gesture, an assistive-technology dismiss — reaches it. All of them arrive as one
  // `close` event, so the sheet has exactly one way out and it is `onSheetClose`.
  let sheetEl: HTMLDialogElement | null = null;
  $: if (sheetEl && sheet && !sheetEl.open) {
    sheetEl.showModal();
    if (sheet === 'capture' || sheet === 'ask') {
      // A typing sheet — Capture's Dump, Ask's question — opens to type, so the field takes
      // focus back from the close control showModal() lands it on. On a phone that is the
      // keyboard rising; on a desktop it is the first character needing no tap.
      sheetEl.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true });
    } else {
      // A reading sheet is for reading, not typing, so focus lands on the way out rather than
      // the first link — the close control — the way a modal dialog conventionally does.
      sheetEl.querySelector<HTMLButtonElement>('.sheet__close')?.focus({ preventScroll: true });
    }
  }

  /** Open the Capture sheet. A session left unsaved by a failed commit reopens exactly where
   *  it was: the preview is still a decision the user has to make, and the Dump is still
   *  Pending behind it. */
  function openCapture() {
    sheet = 'capture';
  }

  /** Ask the sheet to close; the work happens in `onSheetClose`, which every other way out
   *  (Esc, the back gesture) also arrives through. */
  function closeCapture() {
    sheetEl?.close();
  }

  /** The sheet closed, however it was asked to. Return to the grid, and settle the session.
   *
   *  Closing with the countdown running is the same as walking away from it: the clock was on
   *  screen promising a save, so it is honoured now rather than leaving the thought in limbo.
   *
   *  Closing while Held — or with an Append the user has not confirmed — files nothing, because
   *  both states exist precisely to say "not on your own". The Dump is already Pending, so it
   *  appears on the grid as a Pending card and is re-surfaced on the next open. */
  function onSheetClose() {
    sheet = null;
    if (!session || session.saved) return;
    if (held || (session.match.kind === 'append' && !appendConfirmed)) {
      autosaver.cancel();
      endSession();
      void refreshPending();
      return;
    }
    void autosaver.flush();
  }

  /** Stop the countdown. Not a pause: the timer is cancelled, and the only thing that files
   *  the Note afterwards is the user pressing Save. */
  function holdCapture() {
    if (!session || session.saved) return;
    autosaver.cancel();
    held = true;
  }

  /** Clear the review session's state back to a blank Capture sheet. */
  function endSession() {
    session = null;
    context = '';
    held = false;
    appendConfirmed = false;
    contextRevision = 0;
  }

  /** Mark a card as just filed. The ring and the slot-in are the receipt; they clear
   *  themselves, so nothing accumulates on the grid. */
  function markWet(path: string) {
    wetPath = path;
    if (wetTimer) clearTimeout(wetTimer);
    wetTimer = setTimeout(() => {
      wetTimer = null;
      wetPath = null;
    }, WET_MS);
  }

  // Cmd/Ctrl+Enter commits the surface you're typing in. The product's thesis is speed at
  // capture; until now no keyboard accelerator existed anywhere in the app.
  function commitOnModEnter(e: KeyboardEvent, run: () => void, disabled: boolean) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!disabled) run();
    }
  }

  // ── The Note sheet (ticket 06) ──────────────────────────────────────────────
  // The card was a door, so nothing the card truncated may stay truncated here: tapping a
  // card opens the whole Note at full length, every Tag shown, the Related links followed,
  // and the verbatim Dump kept as provenance. It is reached from the grid and returns to it.

  /** Open the Note a card points at, reading it live from the Vault. The card is a door; the
   *  sheet is the room behind it. A Note deleted between the tap and the read shows as gone
   *  rather than throwing — the grid will reconcile it away on the next open. */
  async function openNote(path: string) {
    sheet = 'note';
    status = '';
    noteView = null;
    noteLoading = true;
    try {
      noteView = await readNote(path, storeDeps());
    } catch (e) {
      status = `Could not read the Note: ${(e as Error).message}`;
    } finally {
      noteLoading = false;
    }
  }

  /** Ask the sheet to close; `onNoteSheetClose` does the work, and it is the one way out. */
  function closeNote() {
    sheetEl?.close();
  }

  /** The Note sheet closed, however it was asked to (Esc, the close control, the back
   *  gesture). Return to the grid and drop the Note view — the next open reads it fresh. */
  function onNoteSheetClose() {
    sheet = null;
    noteView = null;
  }

  /** Re-organize the Note on screen: re-derive its title, Tags, summary and Category from the
   *  current body (the user may have edited it in Obsidian), preserving the body, and paint
   *  the refreshed Note back into the sheet. The card on the grid is now stale, so the grid is
   *  refreshed too — this is where re-organize finally lives (ticket 05 left it with no surface). */
  async function reorganizeCurrentNote() {
    if (!noteView) return;
    reorganizing = true;
    try {
      const view = await reorganizeNote(noteView.path, {
        ...storeDeps(),
        organizer: createOrganizer(settings, log),
        now: () => Date.now(),
      });
      if (view) {
        noteView = view;
        status = `Re-organized: ${view.note.title}`;
        void enterGrid();
      }
    } catch (e) {
      status = `Could not re-organize: ${(e as Error).message}`;
    } finally {
      reorganizing = false;
    }
  }

  // ── The Ask sheet (ticket 07) ───────────────────────────────────────────────
  // Retrieve on its own full-screen surface, mirroring Capture — drop in, focus, return. The
  // question sits at the top, the synthesized answer below it, then the Notes the answer drew on
  // shown as the same cards the grid shows — tappable into the Note sheet, so checking an answer
  // against the user's own words is one tap. Sheets do not nest, so tapping a cited card swaps
  // the Ask sheet for the Note sheet (openNote sets `sheet = 'note'`, which replaces this
  // dialog); closing the Note returns to the grid, not back here.

  /** Open the Ask sheet, focusing the question the way Capture focuses the Dump. */
  function openAsk() {
    sheet = 'ask';
  }

  /** Ask the sheet to close; `onAskSheetClose` does the work, and it is the one way out. */
  function closeAsk() {
    sheetEl?.close();
  }

  /** The Ask sheet closed, however it was asked to (Esc, the close control, the back gesture).
   *  Return to the grid; the question and answer stay in state, so reopening drops back in. */
  function onAskSheetClose() {
    sheet = null;
  }

  onMount(async () => {
    settings = await loadSettings();
    // The grid is the surface the app opens on, so its read starts immediately. It never gates
    // the Capture control, which renders regardless of how far the read has got.
    void enterGrid();

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
    onOnline = () => {
      void recover();
      // A restored connection may have recovered Dumps into Notes on another device — refresh
      // the grid when it is the surface the user is looking at.
      if (view === 'grid') void enterGrid();
    };
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
    if (wetTimer) clearTimeout(wetTimer);
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
        // No preview to review, so there is nothing to keep the sheet open for. The grid is
        // where the Dump now is — as a Pending card — and where the message is read.
        closeCapture();
        return;
      }

      session = outcome.session;
      context = '';
      held = false;
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
      // Held means the clock is stopped and stays stopped: typing must not start it again
      // behind the user, which is the whole point of the button they pressed.
      if (!held) {
        autosaver.schedule();
        contextRevision += 1;
      }
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
      const appended = session.match.kind === 'append';
      const appendedTo = session.match.suggestion?.title;
      session = result.session;
      await refreshPending();
      if (result.ok) {
        // Back to the grid, with the card the commit produced already on it. The card comes
        // from the Note in hand rather than a second Vault read: the receipt must not cost
        // the capture path a full-Vault round trip.
        cards = await fileOnGrid(
          cards,
          { note: result.note, path: result.written.path, appended },
          cardCache,
        );
        cardsLoaded = true;
        markWet(result.written.path);
        status = appended
          ? `Appended to: ${appendedTo ?? result.note.title}`
          : `Saved Note: ${result.note.title}`;
        // Closed through the dialog, so the browser tears the sheet out of the top layer and
        // hands focus back to the grid itself. `onSheetClose` returns without touching the
        // session — it is saved — so the session is settled here.
        closeCapture();
        endSession();
      } else {
        // The Dump persists; the Note will be generated from it later. Whether the save came
        // from the timer firing or from a flush, no timer is armed afterwards — so the
        // countdown really has stopped, and the sheet says Held rather than redrawing an edge
        // that is draining towards nothing.
        held = true;
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
  // happen on its own, the clock runs honestly from full. Unless the user pressed Hold — a
  // stopped clock stays stopped whatever else they decide.
  function chooseNewNote() {
    if (!session || session.saved) return;
    session = { ...session, match: { kind: 'new' } };
    appendConfirmed = false;
    if (!held) {
      contextRevision += 1;
      autosaver.schedule();
    }
    status = held ? 'Will save as a new Note when you file it.' : 'Will save as a new Note.';
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
    askCards = [];
    try {
      const result = await retrieve(question, {
        ...storeDeps(),
        embedder: cachedEmbedder(),
        answerer: createAnswerer(settings, log),
      });
      answer = result.answer;
      // The citations are shown as the same cards the grid shows — projected from the cited
      // Notes through the same `toCard` — so a source is a recognizable, tappable card, not a
      // link. A Note deleted between the answer and this read is simply dropped.
      askCards = await citedCards(result.citations, storeDeps());
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
<!-- A Note card is a door: the whole card opens the Note sheet (ticket 06). The title is no
     longer a link to Obsidian — that door moves into the sheet, where the full Note is — so the
     card reads as one thing to press, not a label with a link inside. A real <button> cannot
     hold an <h3>/<p> (flow content), so the card is an article with the button role and full
     keyboard handling — the accessible clickable-card pattern — rather than an invalid button.
     Declared at the template root so the grid (inside .page) and the Ask sheet's citations
     (a sibling of .page) share one snippet — a citation card is the same card the grid shows
     (ticket 07). -->
{#snippet noteCard(card: NoteCard)}
  <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
  <article
    class="card card--door"
    class:card--cat={hueFor(card.category) !== null}
    class:card--wet={wetPath === card.path}
    style={hueStyle(card.category)}
    role="button"
    tabindex="0"
    aria-label={`Open ${card.title || 'Untitled'}`}
    on:click={() => openNote(card.path)}
    on:keydown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openNote(card.path);
      }
    }}>
    <p class="card__category">{card.category}</p>
    <h3 class="card__title">{card.title || 'Untitled'}</h3>
    {#if card.summary}
      <p class="card__summary">{card.summary}</p>
    {/if}
    {#if card.tags.length}
      <p class="card__tags">
        {#each card.tags.slice(0, 3) as tag}<span class="card__tag">{tag}</span>{/each}
        {#if card.tags.length > 3}<span class="card__tag-more">+{card.tags.length - 3} more</span>{/if}
      </p>
    {/if}
    <p class="card__date">{new Date(card.createdAt).toLocaleDateString()}</p>
  </article>
{/snippet}

<div class="page" class:wide={view === 'grid'}>
  <header class="masthead">
    <h1 class="wordmark">brain-dump</h1>
    <nav>
      <button
        class:on={view === 'grid'}
        aria-current={view === 'grid' ? 'page' : undefined}
        on:click={() => { view = 'grid'; void enterGrid(); }}>grid</button>
      <button
        class:on={sheet === 'capture'}
        aria-current={sheet === 'capture' ? 'page' : undefined}
        on:click={() => { view = 'grid'; openCapture(); }}>capture</button>
      <button
        class:on={sheet === 'ask'}
        class:nav-dimmed={vaultIsEmpty}
        aria-current={sheet === 'ask' ? 'page' : undefined}
        disabled={vaultIsEmpty}
        title={vaultIsEmpty ? 'Ask needs a Note to answer from' : undefined}
        on:click={() => { view = 'grid'; openAsk(); }}>ask</button>
      <button
        class:on={view === 'config'}
        aria-current={view === 'config' ? 'page' : undefined}
        on:click={() => (view = 'config')}>settings</button>
    </nav>
  </header>

  <main>
  {#if view === 'grid'}
    <section class="surface grid-surface">
    <!-- The Capture control lives on the grid and never waits on the card read — the grid is
         the road to capture, and capture friction is the one unforgivable failure. -->
    <div class="actions grid-controls">
      <button class="primary" on:click={openCapture}>Capture</button>
    </div>

    <!-- The recovery banner. It used to live on the capture surface; a Capture sheet has room
         for the field and nothing else, and this speaks for the whole app rather than for the
         thought being typed, so it belongs out here. Four states, kept distinct on purpose:
         collapsing them into one "waiting" line would restore the ambiguity that caused
         finding 02 — the user could not tell a Dump being worked on from one nothing was
         happening to. Stranded outranks the rest; it is the app admitting it broke its
         promise. (Ticket 09 replaces this strip with the designed status line.) -->
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

    {#if pendingRecords.length}
      <!-- Pending Dumps: captured, not yet a Note. Dashed and hue-less — raw scaffolding the app
           owes the user a Note for — with no actions, because recovery is automatic. -->
      <div class="grid">
        {#each pendingRecords as r (r.dump.id)}
          <article class="card card--open">
            <p class="card__category">Pending</p>
            <h3 class="card__title card__title--raw">{firstLine(r.dump.content)}</h3>
            {#if r.lastError}
              <p class="card__summary">{r.lastError}</p>
            {/if}
            <p class="card__date">{new Date(r.dump.createdAt).toLocaleDateString()}</p>
          </article>
        {/each}
      </div>
    {/if}

    {#if strandedInVault.length}
      <!-- Stranded Dumps: a Note was never written, or the one written is gone. Same dashed
           card, but it carries the reason and the two things the user can do about it — Retry
           (Organize an unfiled Dump, restore a deleted one) and Dismiss — right where they
           found it. -->
      <div class="grid">
        {#each strandedInVault as s (s.dump.id)}
          <article class="card card--open">
            <p class="card__category">Stranded</p>
            <h3 class="card__title card__title--raw">{firstLine(s.dump.content)}</h3>
            <p class="card__summary">
              {#if s.reason === 'unfiled'}
                never became a Note
              {:else if s.reason === 'note-deleted'}
                its Note was deleted — {s.notePath}
              {:else if s.reason === 'note-unreadable'}
                its Note exists but Obsidian will not write it — {s.notePath}
              {:else}
                the Dump and its Note were both deleted
              {/if}
            </p>
            <div class="card__actions">
              {#if s.reason === 'unfiled'}
                <button on:click={() => organizeStranded(s.dump)} disabled={!!organizingStranded}>
                  {organizingStranded === s.dump.id ? 'Retrying…' : 'Retry'}
                </button>
              {:else}
                <button on:click={() => restoreDeleted(s)} disabled={!!organizingStranded}>
                  {organizingStranded === s.dump.id ? 'Retrying…' : 'Retry'}
                </button>
              {/if}
              <button on:click={() => dismissStranded(s)} disabled={!!organizingStranded}>Dismiss</button>
            </div>
            <p class="card__date">{new Date(s.dump.createdAt).toLocaleDateString()}</p>
          </article>
        {/each}
      </div>
    {/if}

    {#if cards.length}
      <div class="grid">
        {#each cards as card (card.path)}
          {@render noteCard(card)}
        {/each}
      </div>
    {:else if cardsLoaded && !pendingRecords.length && !strandedInVault.length}
      <!-- An empty Vault is calm, not broken: show where the first card will land. The placeholder
           waits only when there are no open thoughts either — a Pending or Stranded card is
           already something on screen. -->
      <div class="grid">
        <p class="card-placeholder">Your first thought will land here.</p>
      </div>
    {:else if !pendingRecords.length && !strandedInVault.length}
      <!-- A cold or failed cache never blocks capture: no spinner, just the grid frame. Open
           thoughts, when present, already fill the surface, so the empty frame is only for the
           truly empty case. -->
      <div class="grid"></div>
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

  <!-- The status line renders on whichever surface is on top: inside the sheet while one is
       open, on the page otherwise. One live region at a time, so a message is announced once. -->
  {#if status && !sheet}<p class="status" aria-live="polite">{status}</p>{/if}
  </main>
</div>

{#if sheet === 'capture'}
  <!-- The Capture sheet. A full-screen surface over the grid, and the whole of it: one field
       and nothing competing with it while the thought comes out. Once Organize has run the
       field yields to the whole Note — not a summary standing in for it — with the countdown
       riding its top edge, and committing drops the user back on the grid with the card. -->
  <dialog
    class="sheet"
    bind:this={sheetEl}
    on:close={onSheetClose}
    aria-label={session ? 'Review the Note before it files' : 'Capture a thought'}>
    <div class="sheet__inner">
      <div class="sheet__bar">
        <p class="sheet__title">{session ? 'before it files' : 'catch a thought'}</p>
        <button class="sheet__close" on:click={closeCapture}>close</button>
      </div>

      <div class="sheet__body">
        {#if !session}
          <!-- The Dump is the product, not a form field: set in the content face, at content
               size, and named for assistive tech without a visible label — a label above it
               would make it a form control, which is the one thing it must not look like.
               Every other field in the app carries its label on screen; this one carries it
               in the name. -->
          <textarea
            class="dump"
            bind:value={text}
            on:input={persistDraft}
            on:keydown={(e) => commitOnModEnter(e, captureDump, busy || !text.trim())}
            aria-label="Dump — what are you thinking?"
            placeholder="What are you thinking?"
            disabled={busy}></textarea>
        {:else}
          <!-- The whole Note, before it is committed. You are approving a Note, so you are
               shown one — every field of it, at full length. -->
          <article class="note">
            {#key contextRevision}
              <div class="burn" class:burn--held={held || (session.match.kind === 'append' && !appendConfirmed)}></div>
            {/key}

            <p class="eyebrow">
              {#if session.match.kind === 'new'}
                New Note
              {:else}
                Append to <span class="keep-case">&ldquo;{session.match.suggestion?.title ?? 'an existing Note'}&rdquo;</span>
              {/if}
            </p>

            <h2>{session.preview.title}</h2>

            <dl class="meta">
              {#if session.preview.tags.length}
                <dt>tags</dt>
                <dd>{session.preview.tags.join('  ')}</dd>
              {/if}
              {#if session.preview.category !== 'uncategorized'}
                <dt>category</dt>
                <dd>{session.preview.category}</dd>
              {/if}
            </dl>

            {#if session.preview.body}
              <div class="note-body">{session.preview.body}</div>
            {/if}

            {#if session.preview.summary}
              <p class="rule-label">summary</p>
              <p>{session.preview.summary}</p>
            {/if}

            {#if session.preview.keyPoints.length}
              <p class="rule-label">key points</p>
              <ul>{#each session.preview.keyPoints as point}<li>{point}</li>{/each}</ul>
            {/if}

            <p class="rule-label">related</p>
            {#if session.preview.related.length}
              <ul class="links">{#each session.preview.related as link}<li><a class="vault-link" href={linkHref(settings.vaultName, link)}>{linkText(link)}</a></li>{/each}</ul>
            {:else}
              <p class="pending">Links are found when the Note is saved.</p>
            {/if}
          </article>

          <label class="context-field">
            add context
            <textarea
              bind:value={context}
              on:input={onContextInput}
              on:keydown={(e) => commitOnModEnter(
                e,
                () => autosaver.flush(),
                // The context field only renders with a session; the !session guard is for the
                // type checker, not the runtime — it makes an absent session a no-op rather
                // than a null deref. Matches the "Save now" visibility rule below.
                !session || (session.match.kind === 'append' && !appendConfirmed),
              )}></textarea>
          </label>
          <p class="hint">
            {#if session.match.kind === 'append' && !appendConfirmed}
              Append waits for your confirmation — it won’t save on its own. Your verbatim original is kept.
            {:else if held}
              Held — the countdown is stopped and won’t restart. It saves when you say so.
            {:else}
              Saves 5 seconds after you stop typing. Your verbatim original is kept.
            {/if}
          </p>
        {/if}
      </div>

      <div class="sheet__foot">
        {#if status}<p class="status" aria-live="polite">{status}</p>{/if}
        <div class="actions">
          {#if !session}
            <button class="primary" on:click={captureDump} disabled={busy || !text.trim()}>
              {busy ? 'Capturing…' : 'Capture'}
            </button>
          {:else if session.match.kind === 'append' && !appendConfirmed}
            <!-- The app files and the user signs once: the suggested Append is the primary
                 action, and founding a new Note stays available as the quiet override. Nothing
                 files until one of them is pressed. -->
            <button class="primary" on:click={confirmAppend}>Append</button>
            <button on:click={chooseNewNote}>Save as new Note</button>
          {:else}
            <!-- "Save now" forces the autosave, and after a Hold it is the only thing that
                 files the Note. It is only shown where a save will actually happen — an
                 unconfirmed append no-ops, so on that path the two buttons above are the save. -->
            <button class="primary" on:click={() => autosaver.flush()}>Save now</button>
            {#if !held}
              <button on:click={holdCapture}>Hold</button>
            {/if}
          {/if}
        </div>
      </div>
    </div>
  </dialog>
{/if}

{#if sheet === 'note'}
  <!-- The Note sheet. The dry twin of the pre-commit preview, at full length: the card was a
       door, so nothing it truncated stays truncated here. Every Tag wraps rather than hiding
       behind `+N more`; the body, the key points and the Related links are shown in full; the
       verbatim Dump is the user's original words, kept as provenance behind the organized
       thought; and the eyebrow is the filing stamp plus the door back into the Vault. -->
  <dialog
    class="sheet"
    bind:this={sheetEl}
    on:close={onNoteSheetClose}
    aria-label="Read the Note">
    <div class="sheet__inner">
      <div class="sheet__bar">
        <p class="sheet__title">the note</p>
        <button class="sheet__close" on:click={closeNote}>close</button>
      </div>

      <div class="sheet__body">
        {#if noteLoading}
          <p class="pending">Reading the Note…</p>
        {:else if noteView}
          <article class="note committed">
            <!-- The filing stamp and the door back into the Vault: the path is an obsidian://
                 link, so "open it where editing happens" is one tap. -->
            <p class="eyebrow">
              <span class="filed-mark">Filed</span>
              <a class="vault-link" href={obsidianUrl(settings.vaultName, noteView.path)}>{noteView.path}</a>
            </p>

            <h2>{noteView.note.title || 'Untitled'}</h2>

            <dl class="meta">
              {#if noteView.note.tags.length}
                <!-- All the Tags, wrapping — the card showed three and a count; the sheet shows
                     every one. -->
                <dt>tags</dt>
                <dd>{noteView.note.tags.join('  ')}</dd>
              {/if}
              {#if noteView.note.category !== 'uncategorized'}
                <dt>category</dt>
                <dd>{noteView.note.category}</dd>
              {/if}
            </dl>

            {#if noteView.note.body}
              <div class="note-body">{noteView.note.body}</div>
            {/if}

            {#if noteView.note.summary}
              <p class="rule-label">summary</p>
              <p>{noteView.note.summary}</p>
            {/if}

            {#if noteView.note.keyPoints.length}
              <p class="rule-label">key points</p>
              <ul>{#each noteView.note.keyPoints as point}<li>{point}</li>{/each}</ul>
            {/if}

            <p class="rule-label">related</p>
            {#if noteView.note.related.length}
              <ul class="links">
                {#each noteView.note.related as link}
                  <li><a class="vault-link" href={linkHref(settings.vaultName, link)}>{linkText(link)}</a></li>
                {/each}
              </ul>
            {:else}
              <p class="pending">No related documents.</p>
            {/if}

            {#if noteView.dump}
              <!-- The verbatim Dump: the user's original words, kept and reachable but not the
                   headline. Context, if the capture added any, follows it. -->
              <p class="rule-label">your original</p>
              <div class="verbatim">{noteView.dump.content}</div>
              {#if noteView.dump.context}
                <p class="rule-label">context</p>
                <div class="verbatim">{noteView.dump.context}</div>
              {/if}
            {/if}
          </article>
        {:else}
          <!-- The Note was deleted between the tap and the read (Obsidian's own sync can do it).
               The grid reconciles it away on the next open; here it simply is gone. -->
          <p class="pending">This Note is no longer in your Vault.</p>
        {/if}
      </div>

      <div class="sheet__foot">
        {#if status}<p class="status" aria-live="polite">{status}</p>{/if}
        <div class="actions">
          {#if noteView}
            <!-- Re-organize re-derives the metadata from the current body — the user may have
                 edited the Note in Obsidian — and is the one place that action surfaces. -->
            <button on:click={reorganizeCurrentNote} disabled={reorganizing}>
              {reorganizing ? 'Re-organizing…' : 'Re-organize'}
            </button>
          {/if}
        </div>
      </div>
    </div>
  </dialog>
{/if}

{#if sheet === 'ask'}
  <!-- The Ask sheet. Retrieve on its own surface, mirroring Capture — drop in, focus, return.
       The question sits at the top, the synthesized answer below it, then the Notes the answer
       drew on shown as the same cards the grid shows. A cited card taps through into the Note
       sheet: openNote sets `sheet = 'note', which swaps this dialog for the Note sheet (sheets do
       not nest), and closing the Note returns to the grid. -->
  <dialog
    class="sheet"
    bind:this={sheetEl}
    on:close={onAskSheetClose}
    aria-label="Ask your vault">
    <div class="sheet__inner">
      <div class="sheet__bar">
        <p class="sheet__title">ask</p>
        <button class="sheet__close" on:click={closeAsk}>close</button>
      </div>

      <div class="sheet__body">
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
            {#if askCards.length}
              <!-- The Notes the answer drew on, as the same cards the grid shows — a source is a
                   recognizable, tappable card, not a link, so checking the answer against the
                   user's own words is one tap into the Note sheet. -->
              <p class="rule-label">sources</p>
              <div class="grid">
                {#each askCards as card (card.path)}
                  {@render noteCard(card)}
                {/each}
              </div>
            {/if}
          </section>
        {/if}
      </div>
    </div>
  </dialog>
{/if}

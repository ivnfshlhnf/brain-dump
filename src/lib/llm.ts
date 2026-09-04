// The cloud-model plumbing behind the operation layer's seams: the Organizer and
// Matcher (Organize, new-vs-append) and the Embedder and Answerer (Retrieve).
// Best-effort plumbing — verified by the Seam C smoke test (tests/llm-smoke.test.ts) and,
// for the request shape alone, by tests/llm-provider.test.ts. The operation layer
// depends only on the interfaces; tests pass deterministic fakes, the app passes the
// real cloud implementations built here.
//
// The seam speaks the OpenAI-compatible API — the universal cloud interface: it works
// against OpenRouter, OpenAI, Groq, and a local Ollama (via its /v1 compat endpoint)
// alike. `llmProvider` holds the full OpenAI-compatible base URL (e.g.
// https://openrouter.ai/api/v1 or http://localhost:11434/v1). Chat calls POST
// {base}/chat/completions with `response_format: { type: 'json_object' }` so the model
// returns strict JSON we can map onto our output types; embeddings POST {base}/embeddings
// with the separately configured embedder model. Provider/models/key are confirmed at
// config time. (See ADR-0003 for why v1 is OpenAI-compatible rather than Ollama-native.)
import { noopLog, type Log } from './logger';
import { toCategory, CATEGORIES } from './category';
import type {
  Modality,
  Organizer,
  OrganizeOutput,
  Settings,
  Matcher,
  NoteCandidate,
  MatchSuggestion,
  Embedder,
  Answerer,
  AnswerOutput,
  Relater,
  VaultDoc,
} from './types';

export function createOrganizer(
  settings: Settings,
  log: Log = noopLog,
  /** Called with each content delta as it arrives (capture-latency ticket 07). Supplying
   *  it switches the transport to a streamed request whose reply is still consumed whole
   *  and parsed exactly as the non-streamed one — only the delivery differs. Callers
   *  without a watcher (recovery, re-organize) keep the simplest request shape. */
  onToken?: (chunk: string) => void,
): Organizer {
  return {
    async organize(content, modality): Promise<OrganizeOutput> {
      const prompt = buildOrganizePrompt(content, modality, settings.organizeInstruction);
      const reply = onToken
        ? await chatStream(settings, prompt, onToken, log)
        : await chat(settings, prompt, log);
      return parseOrganizeOutput(reply);
    },
  };
}

export function createMatcher(settings: Settings, log: Log = noopLog): Matcher {
  return {
    async match(topic, candidates): Promise<MatchSuggestion> {
      // No candidates → no match to suggest. (The operation layer also guards this,
      // but keeping the LLM call out of the empty case avoids a wasted round-trip.)
      if (candidates.length === 0) return { kind: 'new' };
      const reply = await chat(settings, buildMatchPrompt(topic, candidates), log);
      return parseMatchSuggestion(reply, candidates);
    },
  };
}

/** The cloud embedder, using the configured embedder model. The OpenAI-compatible
 *  /embeddings endpoint takes a batch of inputs and returns one vector each. v1 embeds
 *  the whole vault per query, so this is called with many texts at once. */
export function createEmbedder(settings: Settings, log: Log = noopLog): Embedder {
  return {
    async embed(texts): Promise<number[][]> {
      if (texts.length === 0) return [];
      const url = `${baseUrl(settings)}/embeddings`;
      const data = await timedPost<EmbeddingsResponse>({
        url,
        body: { model: settings.embedderModel, input: texts },
        settings,
        log,
        name: 'embedding',
        failure: 'Embedding request failed',
        detail: { url, model: settings.embedderModel, inputs: texts.length },
      });
      // The provider returns embeddings keyed by `index` in arbitrary order; reorder to
      // match the input texts — a reorder here would silently mis-rank the vault against
      // the question.
      const ordered = [...(data.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      return ordered.map((d) => d.embedding ?? []);
    },
  };
}

/** The answer-synthesis half of RAG: the question plus the most relevant vault Notes
 *  go to the LLM, which answers and names the Notes it drew on. */
export function createAnswerer(settings: Settings, log: Log = noopLog): Answerer {
  return {
    async answer(question, sources): Promise<AnswerOutput> {
      const reply = await chat(settings, buildAnswerPrompt(question, sources), log);
      return parseAnswerOutput(reply);
    },
  };
}

/** The Related judge: given a new Note and the vault documents closest to it, say which are
 *  genuinely Related. It answers with indexes only — the app owns the paths (see `Relater`). */
export function createRelater(settings: Settings, log: Log = noopLog): Relater {
  return {
    async related(subject, candidates): Promise<number[]> {
      if (candidates.length === 0) return [];
      const reply = await chat(settings, buildRelatedPrompt(subject, candidates), log);
      return parseRelatedOutput(reply);
    },
  };
}

function buildRelatedPrompt(
  subject: { title: string; summary: string; content: string },
  candidates: VaultDoc[],
): string {
  const listing = candidates
    .map((c, i) => `${i}: ${c.path}\n   title: ${c.title}\n   content:\n${c.content}`)
    .join('\n\n');
  return [
    'You decide which existing notes a new note is genuinely related to. Reply ONLY with a',
    'JSON object — no prose, no markdown fences — with exactly this field:',
    '- related: the numbers of the notes genuinely related to the new note (array of numbers)',
    'Notes are related when they share an app, project, person, place, event, or topic — even',
    'if they look at it from different angles or at different times. A reader of one would want',
    'to read the other. Return an empty array only when nothing shares any of those threads.',
    `New note title: ${subject.title}`,
    `New note summary: ${subject.summary}`,
    'New note content:',
    subject.content,
    'Existing notes:',
    listing,
  ].join('\n');
}

/** Parse the judge's reply. Indexes are passed through as given — `related.ts` owns validating
 *  them against the candidate list, so an invented index is dropped there rather than here. */
function parseRelatedOutput(raw: string): number[] {
  const json = JSON.parse(stripFences(raw)) as { related?: unknown };
  return Array.isArray(json.related) ? json.related.map(num) : [];
}

function buildAnswerPrompt(question: string, sources: VaultDoc[]): string {
  const listing = sources
    .map((s, i) => `${i}: ${s.path}\n   title: ${s.title}\n   content:\n${s.content}`)
    .join('\n\n');
  return [
    "You answer a question from the user's own notes. Reply ONLY with a JSON object —",
    'no prose, no markdown fences — with exactly these fields:',
    '- answer: the answer in plain prose, drawn only from the notes below (string)',
    '- sources: the numbers of the notes you actually drew on (array of numbers)',
    'If the notes do not answer the question, say so in `answer` and return an empty `sources`.',
    `Question: ${question}`,
    'Notes:',
    listing,
  ].join('\n');
}

/** Parse the model's answer reply. The chosen source numbers are passed through as
 *  given — the operation layer owns what may be cited and validates them there, so
 *  an empty list stays empty (the model drew on nothing) rather than being confused
 *  with a list of bad indexes. */
function parseAnswerOutput(raw: string): AnswerOutput {
  const json = JSON.parse(stripFences(raw)) as { answer?: unknown; sources?: unknown };
  const sources = Array.isArray(json.sources) ? json.sources.map(num) : [];
  return { answer: str(json.answer), sources };
}

function buildMatchPrompt(
  topic: { title: string; tags: string[]; summary: string },
  candidates: NoteCandidate[],
): string {
  const listing = candidates
    .map((c, i) => `${i}: ${c.path}\n   title: ${c.title}\n   tags: [${c.tags.join(', ')}]\n   summary: ${c.summary}`)
    .join('\n\n');
  return [
    'You match a new brain-dump against existing Notes by tags and topic. Reply ONLY with a JSON',
    'object — no prose, no markdown fences — with exactly these fields:',
    '- kind: "append" if one existing Note is clearly the same topic, else "new"',
    '- index: the number of the matching Note from the list below, or -1 for "new"',
    'Prefer "new" when in doubt; only "append" for a clear same-topic match.',
    `The new dump: title="${topic.title}" tags=[${topic.tags.join(', ')}] summary="${topic.summary}"`,
    'Existing Notes:',
    listing,
  ].join('\n');
}

/** Parse the model's match reply onto a MatchSuggestion, validating the chosen
 *  index against the candidate list — a bad/out-of-range index falls back to "new". */
function parseMatchSuggestion(raw: string, candidates: NoteCandidate[]): MatchSuggestion {
  const json = JSON.parse(stripFences(raw)) as { kind?: string; index?: unknown };
  const idx = num(json.index);
  if (json.kind === 'append' && idx >= 0 && idx < candidates.length) {
    return { kind: 'append', path: candidates[idx].path };
  }
  return { kind: 'new' };
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : -1;
}

function buildOrganizePrompt(content: string, modality: Modality, instruction: string): string {
  const lines = [
    'You organize a brain-dump into a Note. Reply ONLY with a JSON object — no prose,',
    'no markdown fences — with exactly these fields:',
    '- title: short title (string)',
    '- tags: lowercase one-word tags (array of strings)',
    `- category: exactly one of: ${CATEGORIES.join(', ')} (lowercase string)`,
    '- summary: one sentence that adds something the title and body do not already say —',
    '  empty string when there is nothing to add (string)',
    '- keyPoints: distinct points the body does not already make — empty array when there',
    '  are none (array of strings)',
    "- body: the Dump's content restated in the user's own voice — the Dump's own language,",
    "  register, and length scale. No template headings (no \"Issue\", \"Steps to Reproduce\",",
    '  "Workaround", "Next Steps"): a heading exists only where the Dump itself has',
    '  distinct topics.',
    '',
    'Faithfulness — the one rule that governs every field: derive ONLY from the Dump',
    "below. The Dump is the user's own thought, captured verbatim. Do not add anything",
    'that is not in it: no troubleshooting steps, no causes, no recommendations, no',
    'hypotheses, no "next actions", no advice, and no facts the model knows but the user',
    'did not write. Do not invent section headings the Dump does not support. The body',
    "restates and lightly structures the Dump's actual content — it does not answer,",
    'solve, or expand it. A short Dump yields a short Note — no boilerplate: an empty',
    'summary or empty keyPoints is correct, not a failure. When in doubt, leave something',
    'out rather than invent it.',
  ];
  // The user's standing Instruction (CONTEXT.md: Instruction), verbatim. It sits after the
  // built-in rules and wins where the two conflict: the user opting out of faithfulness is
  // a deliberate act. Empty means no Instruction — the prompt says nothing about it.
  const trimmed = instruction.trim();
  if (trimmed) {
    lines.push(
      '',
      'The user\'s standing instruction for how Notes are organized. It takes precedence',
      'over the rules above where the two conflict:',
      trimmed,
    );
  }
  lines.push(
    `The dump was captured via ${modality}.`,
    `Dump content:`,
    content,
  );
  return lines.join('\n');
}

function authHeaders(settings: Settings): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(settings.llmApiKey ? { Authorization: `Bearer ${settings.llmApiKey}` } : {}),
  };
}

/** The OpenAI-compatible base URL with any trailing slash trimmed (the scheme's `://`
 *  is preserved — stripping only the trailing slash avoids the `http://` → `http:/`
 *  collapse that broke createRemoteDb before ticket 07 fixed it). */
function baseUrl(settings: Settings): string {
  return settings.llmProvider.replace(/\/+$/, '');
}

/** What every OpenAI-compatible reply may carry alongside its payload: the provider's token
 *  accounting. Typed loosely and on purpose — the fields differ by provider and grow over
 *  time (`prompt_tokens`, `completion_tokens`, and on a reasoning model `reasoning_tokens`),
 *  and this is logged verbatim rather than mapped onto app-owned names. Mapping it would mean
 *  the log could only ever show the fields this app already knew to ask about, which is the
 *  opposite of what it is for. */
type Usage = { usage?: Record<string, unknown> };

/** The OpenAI-compatible chat-completions response: the reply text is the first choice's
 *  message content. Named so the contract is explicit rather than re-inlined at each call. */
type ChatResponse = Usage & { choices?: { message?: { content?: string } }[] };

/** The OpenAI-compatible embeddings response: one embedding per input, keyed by `index`
 *  in arbitrary order. Named so the reorder contract is explicit. */
type EmbeddingsResponse = Usage & { data?: { embedding?: number[]; index?: number }[] };

async function chat(settings: Settings, prompt: string, log: Log = noopLog): Promise<string> {
  const url = `${baseUrl(settings)}/chat/completions`;
  const data = await timedPost<ChatResponse>({
    url,
    body: {
      model: settings.llmModel,
      stream: false,
      response_format: { type: 'json_object' },
      // Explicitly off, never left to the provider default: `deepseek-v4-flash` defaults to
      // `default_effort: "high"` and `glm-5.3-flash` is mandatory max, so Organize, Match and
      // Related were all thinking on every capture. These are extraction and classification
      // shapes — the opposite of what a thinking budget helps with (capture-latency ticket 02).
      // `enabled: false` and not `exclude: true`, which hides the reasoning while still paying
      // for the tokens. A model that refuses to disable it is a Settings problem: no per-model
      // branching.
      reasoning: { enabled: false },
      messages: [{ role: 'user', content: prompt }],
    },
    settings,
    log,
    name: 'chat',
    failure: 'LLM request failed',
    // The resolved URL, not the configured one: an `llmProvider` that is blank or missing
    // its scheme resolves against the app's own origin, and seeing that in the log is the
    // difference between "404 Not Found" and "you posted to your own dev server".
    detail: { url, model: settings.llmModel },
  });
  return data.choices?.[0]?.message?.content ?? '';
}

/** POST a JSON body to the provider and return the parsed reply, timing the round trip and
 *  recording it.
 *
 *  Both cloud calls go through here so the timing contract cannot drift between them: one
 *  definition of when the clock starts, what counts as elapsed, and what a resolved call
 *  reports. Three lines are emitted per call —
 *
 *  - **request**, before the fetch, so a call that never returns is still visible as a start
 *    with no end. This is the shape a hang takes in the durable log.
 *  - **resolved**, carrying `ms` and the provider's `usage` verbatim. Without it the log
 *    could only say a request began, and every latency figure had to be reconstructed by
 *    subtracting the timestamps of adjacent, unrelated lines.
 *  - **failed**, carrying `ms` as well. A call that took thirty seconds to fail is a
 *    different problem from one that failed at once, and the two were indistinguishable.
 *
 *  Elapsed time spans the fetch *and* the body parse, because that is the whole of what the
 *  caller waits for. A rejected fetch — the offline `Load failed` that reaches the capture
 *  path — is logged here too and rethrown untouched; it previously left no trace at this
 *  level at all, so a network failure and a slow provider looked the same from the log. */
async function timedPost<T>(opts: {
  url: string;
  body: unknown;
  settings: Settings;
  log: Log;
  /** Names the call in the log messages: `<name> request`, `<name> request resolved`. */
  name: string;
  /** Prefix of the thrown Error on a non-OK status. */
  failure: string;
  /** Logged on all three lines, so one call's records are greppable as a set. */
  detail: Record<string, unknown>;
}): Promise<T> {
  const { url, body, settings, log, name, failure, detail } = opts;
  log({ op: 'http', message: `${name} request`, detail });

  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: authHeaders(settings),
      body: JSON.stringify(body),
    });
  } catch (e) {
    log({
      level: 'error',
      op: 'http',
      message: `${name} request failed`,
      detail: { ...detail, ms: elapsed(), error: (e as Error).message },
    });
    throw e;
  }

  if (!res.ok) {
    log({
      level: 'error',
      op: 'http',
      message: `${name} request failed`,
      detail: { ...detail, ms: elapsed(), status: res.status, statusText: res.statusText },
    });
    throw new Error(`${failure}: ${res.status} ${res.statusText} (POST ${url})`);
  }

  const data = (await res.json()) as T & Usage;
  log({
    op: 'http',
    message: `${name} request resolved`,
    // `usage` is spread in only when the provider sent one: an absent usage block is absent
    // from the log rather than reported as zeros, which would read as "no tokens" instead of
    // "this provider does not say".
    detail: { ...detail, ms: elapsed(), ...(data?.usage ? { usage: data.usage } : {}) },
  });
  return data;
}

/** One streamed chat-completions chunk: content arrives on `choices[].delta`, and the
 *  token accounting arrives on the final chunk (only when the request asked for it). */
type ChatStreamChunk = Usage & { choices?: { delta?: { content?: string } }[] };

/** The streamed transport behind the capture sheet's Organize call (capture-latency
 *  ticket 07). Measured Organize still sits at or past the 10-second attention limit on
 *  ~240 completion tokens (~20 tok/s from the provider, reasoning off — the recorded gate
 *  numbers are in `.scratch/capture-latency/issues/07`), so the sheet shows liveness: the
 *  callback fires as output arrives. The reply is still consumed whole and parsed exactly
 *  as the non-streamed one — `parseOrganizeOutput` is untouched, no incremental JSON —
 *  and the three-line log contract (request / resolved / failed, with `ms` and `usage`)
 *  holds identically. Every failure mode is a failed call, the same as a failed request:
 *  the fetch rejects, a non-OK status, a stream that errors mid-reply, a stream that ends
 *  without `[DONE]` — partial output is never parsed, because a truncated reply would
 *  fail downstream with an error blaming the model rather than the transport. */
async function chatStream(
  settings: Settings,
  prompt: string,
  onToken: (chunk: string) => void,
  log: Log = noopLog,
): Promise<string> {
  const url = `${baseUrl(settings)}/chat/completions`;
  const detail = { url, model: settings.llmModel, stream: true };
  log({ op: 'http', message: 'chat request', detail });

  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  const fail = (error: string, extra: Record<string, unknown>): Error => {
    log({
      level: 'error',
      op: 'http',
      message: 'chat request failed',
      detail: { ...detail, ms: elapsed(), ...extra },
    });
    return new Error(`LLM request failed: ${error}`);
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: authHeaders(settings),
      body: JSON.stringify({
        model: settings.llmModel,
        stream: true,
        // Usage arrives only when asked for: with include_usage the final chunk carries the
        // same token accounting the non-streamed reply does, so ticket 01's log contract
        // holds on the stream too.
        stream_options: { include_usage: true },
        response_format: { type: 'json_object' },
        reasoning: { enabled: false },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  } catch (e) {
    throw fail((e as Error).message, {});
  }

  if (!res.ok || !res.body) {
    throw fail(`${res.status} ${res.statusText} (POST ${url})`, {
      status: res.status,
      statusText: res.statusText,
    });
  }

  let reply = '';
  try {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let usage: Record<string, unknown> | undefined;
    let doneSentinel = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const text = line.trim();
        if (!text.startsWith('data:')) continue; // SSE comments, keep-alives
        const payload = text.slice('data:'.length).trim();
        if (payload === '[DONE]') {
          doneSentinel = true;
          continue;
        }
        const chunk = JSON.parse(payload) as ChatStreamChunk;
        if (chunk.usage) usage = chunk.usage;
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          reply += delta;
          onToken(delta);
        }
      }
    }
    if (!doneSentinel) throw new Error('the stream ended without [DONE]');
    log({
      op: 'http',
      message: 'chat request resolved',
      detail: { ...detail, ms: elapsed(), ...(usage ? { usage } : {}) },
    });
  } catch (e) {
    throw fail((e as Error).message, {});
  }
  return reply;
}

/** Parse the model's JSON reply onto OrganizeOutput, tolerating fences and loose typing. */
function parseOrganizeOutput(raw: string): OrganizeOutput {
  const json = JSON.parse(stripFences(raw)) as Record<string, unknown>;
  return {
    title: str(json.title),
    tags: strArray(json.tags),
    // Coerce the model's reply into the closed set — a non-member or a blank becomes
    // `uncategorized`, an ordinary member, not an error (ticket 04; spec.md §Category).
    category: toCategory(str(json.category)),
    summary: str(json.summary),
    keyPoints: strArray(json.keyPoints),
    related: strArray(json.related),
    body: str(json.body),
  };
}

function stripFences(raw: string): string {
  const fenced = raw.trim().match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return fenced ? fenced[1].trim() : raw.trim();
}

function str(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v == null) return '';
  return String(v);
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => str(x)) : [];
}
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

export function createOrganizer(settings: Settings, log: Log = noopLog): Organizer {
  return {
    async organize(content, modality): Promise<OrganizeOutput> {
      const reply = await chat(settings, buildOrganizePrompt(content, modality), log);
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
      log({
        op: 'http',
        message: 'embedding request',
        detail: { url, model: settings.embedderModel, inputs: texts.length },
      });
      const res = await fetch(url, {
        method: 'POST',
        headers: authHeaders(settings),
        body: JSON.stringify({ model: settings.embedderModel, input: texts }),
      });
      if (!res.ok) {
        log({
          level: 'error',
          op: 'http',
          message: 'embedding request failed',
          detail: { url, model: settings.embedderModel, status: res.status, statusText: res.statusText },
        });
        throw new Error(
          `Embedding request failed: ${res.status} ${res.statusText} (POST ${url})`,
        );
      }
      const data = (await res.json()) as EmbeddingsResponse;
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
    'A note is related if a reader of one would want to read the other. Being about a similar',
    'subject is not enough on its own. Return an empty array if none qualify — that is a good',
    'answer, not a failure.',
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

function buildOrganizePrompt(content: string, modality: Modality): string {
  return [
    'You organize a brain-dump into a Note. Reply ONLY with a JSON object — no prose,',
    'no markdown fences — with exactly these fields:',
    '- title: short title (string)',
    '- tags: lowercase one-word tags (array of strings)',
    '- category: one category (string)',
    '- summary: one-sentence summary (string)',
    '- keyPoints: concise bullets (array of strings)',
    '- related: Obsidian wikilinks or URLs, empty if none (array of strings)',
    '- body: the cleaned, organized content in markdown (string)',
    '',
    'Faithfulness — the one rule that governs every field: derive ONLY from the Dump',
    "below. The Dump is the user's own thought, captured verbatim. Do not add anything",
    'that is not in it: no troubleshooting steps, no causes, no recommendations, no',
    'hypotheses, no "next actions", no advice, and no facts the model knows but the user',
    'did not write. Do not invent section headings the Dump does not support. The body',
    "restates and lightly structures the Dump's actual content — it does not answer,",
    'solve, or expand it. A short Dump yields a short Note; that is correct, not a',
    'failure. When in doubt, leave something out rather than invent it.',
    `The dump was captured via ${modality}.`,
    `Dump content:`,
    content,
  ].join('\n');
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

/** The OpenAI-compatible chat-completions response: the reply text is the first choice's
 *  message content. Named so the contract is explicit rather than re-inlined at each call. */
type ChatResponse = { choices?: { message?: { content?: string } }[] };

/** The OpenAI-compatible embeddings response: one embedding per input, keyed by `index`
 *  in arbitrary order. Named so the reorder contract is explicit. */
type EmbeddingsResponse = { data?: { embedding?: number[]; index?: number }[] };

async function chat(settings: Settings, prompt: string, log: Log = noopLog): Promise<string> {
  const url = `${baseUrl(settings)}/chat/completions`;
  // The resolved URL, not the configured one: an `llmProvider` that is blank or missing
  // its scheme resolves against the app's own origin, and seeing that in the log is the
  // difference between "404 Not Found" and "you posted to your own dev server".
  log({ op: 'http', message: 'chat request', detail: { url, model: settings.llmModel } });
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(settings),
    body: JSON.stringify({
      model: settings.llmModel,
      stream: false,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    log({
      level: 'error',
      op: 'http',
      message: 'chat request failed',
      detail: { url, model: settings.llmModel, status: res.status, statusText: res.statusText },
    });
    throw new Error(`LLM request failed: ${res.status} ${res.statusText} (POST ${url})`);
  }
  const data = (await res.json()) as ChatResponse;
  return data.choices?.[0]?.message?.content ?? '';
}

/** Parse the model's JSON reply onto OrganizeOutput, tolerating fences and loose typing. */
function parseOrganizeOutput(raw: string): OrganizeOutput {
  const json = JSON.parse(stripFences(raw)) as Record<string, unknown>;
  return {
    title: str(json.title),
    tags: strArray(json.tags),
    category: str(json.category),
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
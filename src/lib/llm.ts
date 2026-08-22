// The cloud-model plumbing behind the operation layer's seams: the Organizer and
// Matcher (Organize, new-vs-append) and the Embedder and Answerer (Retrieve).
// Best-effort plumbing — not unit-tested, like createRemoteDb. The operation layer
// depends only on the interfaces; tests pass deterministic fakes, the app passes the
// real cloud implementations built here.
//
// `llmProvider` holds the provider's base URL (e.g. an Ollama-compatible host).
// Chat calls use Ollama's /api/chat with `format: 'json'` so the model returns strict
// JSON we can map onto our output types; embeddings use /api/embed with the separately
// configured embedder model. Provider/models/key are confirmed at config time.
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
  VaultDoc,
} from './types';

export function createOrganizer(settings: Settings): Organizer {
  return {
    async organize(content, modality): Promise<OrganizeOutput> {
      const reply = await chat(settings, buildOrganizePrompt(content, modality));
      return parseOrganizeOutput(reply);
    },
  };
}

export function createMatcher(settings: Settings): Matcher {
  return {
    async match(topic, candidates): Promise<MatchSuggestion> {
      // No candidates → no match to suggest. (The operation layer also guards this,
      // but keeping the LLM call out of the empty case avoids a wasted round-trip.)
      if (candidates.length === 0) return { kind: 'new' };
      const reply = await chat(settings, buildMatchPrompt(topic, candidates));
      return parseMatchSuggestion(reply, candidates);
    },
  };
}

/** The cloud embedder, using the configured embedder model (Ollama's /api/embed takes
 *  a batch of inputs and returns one vector each). v1 embeds the whole vault per
 *  query, so this is called with many texts at once. */
export function createEmbedder(settings: Settings): Embedder {
  return {
    async embed(texts): Promise<number[][]> {
      if (texts.length === 0) return [];
      const base = settings.llmProvider.replace(/\/+$/, '');
      const res = await fetch(`${base}/api/embed`, {
        method: 'POST',
        headers: authHeaders(settings),
        body: JSON.stringify({ model: settings.embedderModel, input: texts }),
      });
      if (!res.ok) throw new Error(`Embedding request failed: ${res.status} ${res.statusText}`);
      const data = (await res.json()) as { embeddings?: number[][] };
      return data.embeddings ?? [];
    },
  };
}

/** The answer-synthesis half of RAG: the question plus the most relevant vault Notes
 *  go to the LLM, which answers and names the Notes it drew on. */
export function createAnswerer(settings: Settings): Answerer {
  return {
    async answer(question, sources): Promise<AnswerOutput> {
      const reply = await chat(settings, buildAnswerPrompt(question, sources));
      return parseAnswerOutput(reply);
    },
  };
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

async function chat(settings: Settings, prompt: string): Promise<string> {
  const base = settings.llmProvider.replace(/\/+$/, '');
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: authHeaders(settings),
    body: JSON.stringify({
      model: settings.llmModel,
      stream: false,
      format: 'json',
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`LLM request failed: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { message?: { content?: string }; content?: string };
  return data.message?.content ?? data.content ?? '';
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
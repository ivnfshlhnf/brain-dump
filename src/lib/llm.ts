// The cloud-LLM Organizer. Best-effort plumbing — not unit-tested, like createRemoteDb.
// The operation layer is driven through the Organizer interface; tests pass a
// deterministic fake, the app passes the real cloud Organizer built here.
//
// `llmProvider` holds the provider's base URL (e.g. an Ollama-compatible host).
// Uses Ollama's /api/chat with `format: 'json'` so the model returns strict JSON
// we can map onto OrganizeOutput. Provider/model/key are confirmed at config time.
import type { Modality, Organizer, OrganizeOutput, Settings } from './types';

export function createOrganizer(settings: Settings): Organizer {
  return {
    async organize(content, modality): Promise<OrganizeOutput> {
      const reply = await chat(settings, buildOrganizePrompt(content, modality));
      return parseOrganizeOutput(reply);
    },
  };
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

async function chat(settings: Settings, prompt: string): Promise<string> {
  const base = settings.llmProvider.replace(/\/+$/, '');
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(settings.llmApiKey ? { Authorization: `Bearer ${settings.llmApiKey}` } : {}),
    },
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
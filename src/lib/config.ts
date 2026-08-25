// Configuration rules — the checks that decide whether a setting is usable at all.
//
// Distinct from health.ts, which asks live external dependencies whether they answer. These
// rules are pure and local: they can say a value is unusable without touching the network,
// and they run at the moment the user presses Save, while the field is still on screen.
//
// This module exists because the one rule below used to live inside the view component,
// where nothing could test it. A rule that decides whether configuration is accepted is
// behaviour, and behaviour in this codebase lives outside the view.

/** Why a configuration value was rejected.
 *
 *  The `code` is the contract and the `message` is presentation: tests and the diagnostics
 *  log match on the code, the user reads the message. Rewording a message is then free, and
 *  cannot quietly turn a test green.
 */
export interface ConfigProblem<Code extends string> {
  code: Code;
  message: string;
}

export type ProviderUrlCode = 'blank' | 'not-absolute' | 'bad-scheme';
export type ProviderUrlProblem = ConfigProblem<ProviderUrlCode>;

const EXAMPLE = 'https://openrouter.ai/api/v1';

/** The LLM provider must be an absolute http(s) URL — or `null` if it is.
 *
 *  A blank or scheme-less value resolves against the app's own origin, so every cloud call
 *  quietly 404s against the dev server instead of reaching the provider — a failure that only
 *  shows up later, as a Dump left Pending. Catching it at save time points at the field while it is
 *  on screen.
 */
export function validateProviderUrl(url: string): ProviderUrlProblem | null {
  if (!url.trim()) {
    return { code: 'blank', message: `LLM provider is required, e.g. ${EXAMPLE}` };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // A scheme-less value ("openrouter.ai/api/v1") lands here: it is a valid *relative*
    // reference, which is exactly what makes it dangerous, and not a valid absolute URL.
    return {
      code: 'not-absolute',
      message: `"${url}" is not a full URL. Include the scheme, e.g. ${EXAMPLE}`,
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      code: 'bad-scheme',
      message: `LLM provider must be http(s), not "${parsed.protocol}"`,
    };
  }

  return null;
}

// Unit test for the configuration rules in src/lib/config.ts.
//
// This rule used to live inside App.svelte, where no test could reach it — it was trusted
// because it was written carefully rather than because it was pinned. These are the four
// cases it decides.
//
// Assertions are on `code`, never on `message`. The message is presentation and will be
// reworded; if a test matched on wording, rewording would break it and — worse — collapsing
// two distinct rules into one message would silently keep it green.
import { describe, it, expect } from 'vitest';
import { validateProviderUrl } from '../src/lib/config';

describe('validateProviderUrl', () => {
  it('accepts a full https URL', () => {
    expect(validateProviderUrl('https://openrouter.ai/api/v1')).toBeNull();
  });

  it('accepts a full http URL, for a local provider', () => {
    // Ollama's OpenAI-compatible endpoint is the reason http is not rejected outright.
    expect(validateProviderUrl('http://localhost:11434/v1')).toBeNull();
  });

  it('rejects a blank value', () => {
    expect(validateProviderUrl('')?.code).toBe('blank');
  });

  it('rejects whitespace as blank, not as unparseable', () => {
    expect(validateProviderUrl('   ')?.code).toBe('blank');
  });

  it('rejects a scheme-less value', () => {
    // The dangerous case: this is a valid *relative* reference, so it resolves against the
    // app's own origin and every cloud call 404s against the dev server.
    expect(validateProviderUrl('openrouter.ai/api/v1')?.code).toBe('not-absolute');
  });

  it('rejects a non-http(s) scheme', () => {
    expect(validateProviderUrl('ftp://openrouter.ai/api/v1')?.code).toBe('bad-scheme');
  });

  it('names the offending value in the message it gives the user', () => {
    // The wording is free to change; that the user is shown *what* they typed is not.
    expect(validateProviderUrl('openrouter.ai/api/v1')?.message).toContain('openrouter.ai/api/v1');
  });
});

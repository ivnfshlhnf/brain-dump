// obsidian:// links — the door back into the Vault (Seam: the shape-pass commit promotion).
// A saved path, a Related wikilink and an external URL each resolve to the right href, with
// the vault name per-device and slashes kept literal so Obsidian reads the path.
import { describe, it, expect } from 'vitest';
import { obsidianUrl, linkHref, linkText, wikilinkTarget, isExternalUrl } from '../src/lib/obsidian';

describe('obsidianUrl', () => {
  it('builds a vault+file URL when a vault name is set', () => {
    expect(obsidianUrl('Personal', 'Brain Dump/Notes/Outbox retry.md')).toBe(
      'obsidian://open?vault=Personal&file=Brain%20Dump/Notes/Outbox%20retry.md',
    );
  });

  it('omits the vault when none is set, opening the active vault', () => {
    expect(obsidianUrl('', 'Brain Dump/Notes/Outbox retry.md')).toBe(
      'obsidian://open?file=Brain%20Dump/Notes/Outbox%20retry.md',
    );
    expect(obsidianUrl('   ', 'Notes/X.md')).toBe('obsidian://open?file=Notes/X.md');
  });

  it('keeps slashes literal and encodes only within segments', () => {
    // A %2F would point at one oddly-named file; the slash must stay a path separator.
    expect(obsidianUrl('v', 'a/b c/d')).toBe('obsidian://open?vault=v&file=a/b%20c/d');
    expect(obsidianUrl('v', 'a/b c/d')).not.toContain('%2F');
  });

  it('encodes the vault name', () => {
    expect(obsidianUrl('My Vault', 'n.md')).toBe('obsidian://open?vault=My%20Vault&file=n.md');
  });
});

describe('wikilinkTarget', () => {
  it('strips the brackets from a plain wikilink', () => {
    expect(wikilinkTarget('[[Brain Dump/Notes/Some Note]]')).toBe('Brain Dump/Notes/Some Note');
  });

  it('drops an alias and a heading, keeping the file path', () => {
    expect(wikilinkTarget('[[Note|alias]]')).toBe('Note');
    expect(wikilinkTarget('[[Note#heading]]')).toBe('Note');
    expect(wikilinkTarget('[[Note|alias#h]]')).toBe('Note');
  });
});

describe('isExternalUrl', () => {
  it('recognizes http(s) URLs', () => {
    expect(isExternalUrl('https://example.com/x')).toBe(true);
    expect(isExternalUrl('http://example.com')).toBe(true);
  });

  it('rejects wikilinks and bare paths', () => {
    expect(isExternalUrl('[[Note]]')).toBe(false);
    expect(isExternalUrl('Brain Dump/Notes/X.md')).toBe(false);
  });
});

describe('linkHref', () => {
  it('returns an external URL as-is', () => {
    expect(linkHref('vault', 'https://example.com/x')).toBe('https://example.com/x');
  });

  it('turns a wikilink into an obsidian:// URL to its target', () => {
    expect(linkHref('vault', '[[Brain Dump/Notes/Some Note]]')).toBe(
      'obsidian://open?vault=vault&file=Brain%20Dump/Notes/Some%20Note',
    );
  });
});

describe('linkText', () => {
  it('shows the URL for external links', () => {
    expect(linkText('https://example.com/x')).toBe('https://example.com/x');
  });

  it('shows the wikilink target without the brackets', () => {
    expect(linkText('[[Brain Dump/Notes/Some Note]]')).toBe('Brain Dump/Notes/Some Note');
  });
});
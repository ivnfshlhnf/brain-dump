// The closed Category set and its position-derived hue — the heart of ticket 04. Category stops
// being free text so colour can mean something: each member maps to a stable hue stepped by the
// golden angle from its INDEX in the declared list, never from the string. `uncategorized` is an
// ordinary member with no hue — the absence of a Category is not a colour.
//
// Expected hues below are hand-computed from the spec formula `hue = (index * 137.5 + 30) % 360`
// (spec.md §Category), not re-derived from the code — so a wrong formula or a reordered list fails
// the test rather than passing by construction.
import { describe, it, expect } from 'vitest';
import { CATEGORIES, toCategory, hueFor, type Category } from '../src/lib/category';

describe('CATEGORIES — the append-only closed set (#1, #5)', () => {
  it('is exactly the five named members in the declared order', () => {
    expect([...CATEGORIES]).toEqual([
      'troubleshooting', 'productivity', 'tools', 'coffee', 'personal',
    ]);
  });

  it('is frozen — the order is load-bearing, so insert/sort must fail at runtime', () => {
    // A member's hue is its index here. Reordering re-colours every Note in the Vault; the type
    // comment says append-only, and freezing makes an accidental in-place mutation throw.
    expect(Object.isFrozen(CATEGORIES)).toBe(true);
  });

  it('does not include uncategorized — that is the fallback, not a hue-bearing member', () => {
    expect(CATEGORIES).not.toContain('uncategorized');
  });
});

describe('toCategory — total coercion into the closed set (#1, #3)', () => {
  it('accepts a member verbatim', () => {
    expect(toCategory('troubleshooting')).toBe('troubleshooting');
    expect(toCategory('coffee')).toBe('coffee');
  });

  it('is case-insensitive and trims surrounding whitespace', () => {
    expect(toCategory('Troubleshooting')).toBe('troubleshooting');
    expect(toCategory('COFFEE')).toBe('coffee');
    expect(toCategory('  tools  ')).toBe('tools');
  });

  it('maps any non-member — and a blank — to uncategorized, never throwing', () => {
    // Existing Notes carry free-form Categories such as 'Bug Report' and 'Hardware'; those read as
    // uncategorized. A blank Category from the model is the same: no error, no retry, no log noise.
    expect(toCategory('Bug Report')).toBe('uncategorized');
    expect(toCategory('Hardware')).toBe('uncategorized');
    expect(toCategory('home')).toBe('uncategorized'); // lowercase non-member, not 'tools' etc.
    expect(toCategory('')).toBe('uncategorized');
    expect(toCategory('   ')).toBe('uncategorized');
    expect(() => toCategory('anything-at-all')).not.toThrow();
  });
});

describe('hueFor — position-derived hue, never the string (#4, #6, #7)', () => {
  // Hand-computed from (index * 137.5 + 30) % 360:
  //   troubleshooting(0)=30  productivity(1)=167.5  tools(2)=305  coffee(3)=82.5  personal(4)=220
  const expected: Record<string, number> = {
    troubleshooting: 30,
    productivity: 167.5,
    tools: 305,
    coffee: 82.5,
    personal: 220,
  };

  it('derives each member’s hue from its index in the declared list', () => {
    for (const [member, hue] of Object.entries(expected)) {
      expect(hueFor(member as Category)).toBe(hue);
    }
  });

  it('returns a hue in [0, 360) for every member', () => {
    for (const member of CATEGORIES) {
      const h = hueFor(member);
      expect(h).not.toBeNull();
      expect(h!).toBeGreaterThanOrEqual(0);
      expect(h!).toBeLessThan(360);
    }
  });

  it('gives every member a distinct hue — colour conveys which Category', () => {
    const hues = CATEGORIES.map((m) => hueFor(m));
    expect(new Set(hues).size).toBe(hues.length);
  });

  it('is unchanged when another member is appended — hue depends on index, not list length', () => {
    // Appending adds at the end, so existing members keep their index and their hue. The formula
    // is purely index-based, so a sixth member at index 5 would land at (5 * 137.5 + 30) % 360 =
    // 357.5 — distinct from every existing hue, and the existing five are untouched. We assert the
    // five hold their literals (which encode "index, not length") and that a hypothetical index-5
    // hue differs from all of them.
    const fifth = (5 * 137.5 + 30) % 360;
    const existing = CATEGORIES.map((m) => hueFor(m));
    expect(existing).not.toContain(fifth);
    // And the first member still carries index 0's hue regardless of how many follow.
    expect(hueFor('troubleshooting')).toBe(30);
  });

  it('gives uncategorized no hue — the absence of a Category is not a colour (#6)', () => {
    expect(hueFor('uncategorized')).toBeNull();
  });
});
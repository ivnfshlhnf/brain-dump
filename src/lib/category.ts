// The closed Category set and its position-derived hue (ticket 04; spec.md §Category).
//
// Category stops being free text so colour can mean something. Each named member maps to a stable
// hue stepped by the golden angle from its INDEX in `CATEGORIES` below — never from the string.
// `uncategorized` is the fallback member: an ordinary Category that carries no hue, because the
// absence of a Category is not a colour.
//
// APPEND-ONLY — the order is load-bearing. A member's hue is its index here, so adding a member
// at the END is free (existing members keep their index and hue), but INSERTING or SORTING the
// list re-colours every Note in the Vault. Do not reorder. Do not insert. This comment lives on
// the type because the constraint is part of the domain, not just an ADR line.

/** The five named Category members, in their load-bearing order. `uncategorized` is deliberately
 *  absent — it is the fallback, not a hue-bearing member. Frozen so an accidental in-place
 *  insert/sort throws instead of silently re-colouring the Vault. */
export const CATEGORIES = Object.freeze([
  'troubleshooting',
  'productivity',
  'tools',
  'coffee',
  'personal',
] as const);

/** A Category value. One of the five named members, or `uncategorized`. */
export type Category = (typeof CATEGORIES)[number] | 'uncategorized';

/** The fallback Category — the only one that carries no hue. */
export const UNCATEGORIZED = 'uncategorized' as const satisfies Category;

/** Coerce a raw Category string (from frontmatter or a model reply) into a member, or
 *  `uncategorized`. Total: case-insensitive, trims whitespace, and maps any non-member — and a
 *  blank — to `uncategorized`. Never throws, never logs: an out-of-set Category is an ordinary
 *  `uncategorized`, not an error. */
export function toCategory(raw: string): Category {
  const lower = raw.trim().toLowerCase();
  return (CATEGORIES as readonly string[]).includes(lower)
    ? (lower as (typeof CATEGORIES)[number])
    : UNCATEGORIZED;
}

/** The hue for a member, derived from its position in `CATEGORIES` stepped by the golden angle so
 *  any number of members stay well separated. `uncategorized` returns `null` — it uses the neutral
 *  chip treatment Tags use, not a colour. Hue comes from index, never from the string. */
export function hueFor(category: Category): number | null {
  if (category === UNCATEGORIZED) return null;
  const index = CATEGORIES.indexOf(category);
  return index < 0 ? null : (index * 137.5 + 30) % 360;
}
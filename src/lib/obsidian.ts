/** obsidian:// link helpers — the door back into the Vault.
 *
 * A saved Note's path, a Related link and an Ask citation all become `obsidian://open?…`
 * links that open the real file in Obsidian on this device. The vault name is a per-device
 * setting (the vault may be named differently on the laptop and the phone); when it is empty
 * the link omits the vault and Obsidian opens the active one. */

/** A Related entry or citation may be an external URL rather than an Obsidian wikilink. */
export function isExternalUrl(link: string): boolean {
  return /^https?:\/\//i.test(link);
}

/** The file path an Obsidian wikilink `[[path]]` (or `[[path|alias]]`, `[[path#heading]]`)
 *  points at, with the brackets, alias and heading stripped. */
export function wikilinkTarget(link: string): string {
  return link.replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0].split('#')[0];
}

/** Build an `obsidian://open` URL for a vault-relative file path. Each path segment is
 *  percent-encoded but the slashes stay literal — Obsidian's handler reads the slash as a path
 *  separator, so an encoded `%2F` would point at one oddly-named file instead of a path. */
export function obsidianUrl(vault: string, file: string): string {
  const v = vault.trim();
  const f = file.split('/').map(encodeURIComponent).join('/');
  return v
    ? `obsidian://open?vault=${encodeURIComponent(v)}&file=${f}`
    : `obsidian://open?file=${f}`;
}

/** The href for a Related entry or citation link — its own URL if external, else an
 *  obsidian:// link to the wikilink's target. */
export function linkHref(vault: string, link: string): string {
  return isExternalUrl(link) ? link : obsidianUrl(vault, wikilinkTarget(link));
}

/** The display text for a Related entry — the URL if external, else the wikilink's target
 *  (the machine states the location, not the `[[ ]]` syntax). */
export function linkText(link: string): string {
  return isExternalUrl(link) ? link : wikilinkTarget(link);
}
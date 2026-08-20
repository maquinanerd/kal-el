const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Title -> URL slug, pt-BR aware.
 *
 * Combining marks are stripped after NFD so "Eleições" becomes "eleicoes" rather than
 * "eleies"; a naive `[^a-z0-9]` filter deletes the base letter along with its accent.
 * `COMBINING_MARKS` is the U+0300-U+036F block, which renders as an empty-looking
 * character class - it is not empty.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    // same cut as the server (`slugify` in apps/api/src/services/articles.ts). At 96 a
    // long headline produced a client slug the server would never have written, and the
    // comparison below then read that difference as a deliberate edit.
    .slice(0, 120);
}

/**
 * Whether `slug` is what the system would have written for `title` — either the slug
 * itself, or the server's collision form.
 *
 * `uniqueSlug` (apps/api/src/services/articles.ts) appends `-2`, `-3`… when the base is
 * already taken on the site. That is the SERVER disambiguating, not a writer choosing a
 * URL, and the difference is the whole of the bug below.
 */
function slugFollowsTitle(title: string, slug: string): boolean {
  const base = slugify(title);
  if (!base) return true; // an untitled draft cannot have diverged from its title
  if (slug === base) return true;
  if (!slug.startsWith(base + "-")) return false;
  const suffix = slug.slice(base.length + 1);
  return suffix.length > 0 && /^[0-9]+$/.test(suffix);
}

/**
 * Whether the stored slug should stop tracking the title.
 *
 * The rule: a slug follows the title until someone edits it by hand, then it is theirs.
 *
 * A session has no memory of what happened in the last one, so this infers it. The
 * inference was too strict: it required the stored slug to equal `slugify(title)`
 * exactly, so the second draft named "Novo artigo" — stored by the API as
 * `novo-artigo-2` because `novo-artigo` was taken — opened already declaring "Definido
 * manualmente. O título não altera mais este endereço", before its title had been typed.
 * The automatic lifecycle existed and was switched off at birth by the server's own
 * deduplication.
 *
 * A published or scheduled article is always locked. Its URL is public - or about to be -
 * and changing it silently would break links that already exist.
 */
export function slugIsLocked(storedTitle: string, storedSlug: string | null, status: string): boolean {
  if (status === "published" || status === "scheduled" || status === "archived") return true;
  if (!storedSlug) return false;
  return !slugFollowsTitle(storedTitle, storedSlug);
}

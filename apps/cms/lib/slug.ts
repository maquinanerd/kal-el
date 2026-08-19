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
    .slice(0, 96);
}

/**
 * Whether the stored slug should stop tracking the title.
 *
 * The rule the product review expected: a slug follows the title until someone edits it
 * by hand, then it is theirs. The observed bug was the opposite - an article created as
 * "Novo artigo 2" kept the slug `novo-artigo-2` after its title became "Teste Editorial
 * Kal El", so every draft shipped with a meaningless URL.
 *
 * A session has no memory of what happened in the last one, so this infers it: if the
 * stored slug is what the stored title would generate, nobody has touched it and it can
 * keep following. If it diverges, it was deliberate and is left alone.
 *
 * A published or scheduled article is always locked. Its URL is public - or about to be -
 * and changing it silently would break links that already exist.
 */
export function slugIsLocked(storedTitle: string, storedSlug: string | null, status: string): boolean {
  if (status === "published" || status === "scheduled" || status === "archived") return true;
  if (!storedSlug) return false;
  return storedSlug !== slugify(storedTitle);
}

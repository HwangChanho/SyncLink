/**
 * YouTube link helpers for planner notes.
 *
 * Notes are stored as free-form markdown in `todos.content` (ADR-003). When a
 * note body contains a YouTube link, the Notes list shows the video thumbnail
 * (gated behind the `showYoutubeThumbnails` user setting).
 *
 * These helpers are pure and dependency-free so they're trivial to unit-test
 * and safe to reuse anywhere (no React / network / storage coupling).
 */

/**
 * Matches the 11-character YouTube video id across the common URL shapes:
 *   - youtube.com/watch?v=ID            (optionally with other query params)
 *   - youtu.be/ID
 *   - youtube.com/shorts/ID
 *   - youtube.com/live/ID
 *   - youtube.com/embed/ID
 *   - m./www. host variants (the host prefix is intentionally not anchored)
 *
 * The id charset is [A-Za-z0-9_-]; YouTube ids are always 11 chars.
 */
const YOUTUBE_URL_RE =
  /(?:youtube\.com\/(?:watch\?(?:[^\s]*&)?v=|live\/|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i;

/**
 * Extract the first YouTube video id found in arbitrary text.
 *
 * @param text - note body (may be null/undefined for empty notes)
 * @returns the 11-char video id, or null when no YouTube link is present
 */
export function extractYoutubeId(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(YOUTUBE_URL_RE);
  // match?.[1] is `string | undefined` under noUncheckedIndexedAccess → ?? null.
  return match?.[1] ?? null;
}

/**
 * Build a thumbnail image URL for a given video id.
 *
 * We use `hqdefault.jpg` because it is guaranteed to exist for every video.
 * (`maxresdefault.jpg` 404s for videos uploaded without an HD source, which
 * would render a broken image.) hqdefault is 480x360 — plenty for a list card.
 *
 * @param videoId - 11-char YouTube video id
 */
export function youtubeThumbnailUrl(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

/**
 * Convenience: extract the first YouTube link from text and return its
 * thumbnail URL, or null when the text has no YouTube link.
 *
 * @param text - note body
 */
export function firstYoutubeThumbnail(text: string | null | undefined): string | null {
  const id = extractYoutubeId(text);
  return id ? youtubeThumbnailUrl(id) : null;
}

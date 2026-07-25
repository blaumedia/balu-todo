/** Strip the given token spans from `text` and collapse whitespace. */
export function buildTitle(
  text: string,
  tokens: ReadonlyArray<{ start: number; end: number }>,
): string {
  const spans = [...tokens].sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const s of spans) {
    if (s.start > cursor) out += text.slice(cursor, s.start);
    cursor = Math.max(cursor, s.end);
  }
  out += text.slice(cursor);
  return out.replace(/\s+/g, " ").trim();
}

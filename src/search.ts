/**
 * QuikCap Search Service
 *
 * Standalone, pure module — no UI imports, no side effects.
 *
 * Public API:
 *   buildIndex(notes)          → SearchableNote[]
 *   searchNotes(index, query)  → string[]  (ordered note IDs, best match first)
 *
 * Ranking tiers (highest wins):
 *   4 — exact title match
 *   3 — partial title match
 *   2 — exact body match
 *   1 — partial body match
 *
 * Future expansion: add OCR text, attachment content, tags, or semantic
 * embedding scores to scoreNote() without changing the public API shape.
 */

export interface SearchableNote {
  id: string;
  title: string;   // first non-empty line, plain text
  body: string;    // full note body, plain text
  updated_at: number;
}

function scoreNote(note: SearchableNote, lq: string): number {
  const lt = note.title.toLowerCase();
  const lb = note.body.toLowerCase();
  if (lt === lq)       return 4;
  if (lt.includes(lq)) return 3;
  if (lb === lq)       return 2;
  if (lb.includes(lq)) return 1;
  return 0;
}

/**
 * Returns the IDs of matching notes sorted by relevance then recency.
 * Returns an empty array when no notes match.
 * Returns all IDs in recency order when query is blank.
 */
export function searchNotes(index: SearchableNote[], query: string): string[] {
  const lq = query.toLowerCase().trim();
  if (!lq) return index.map((n) => n.id);

  return index
    .map((n) => ({ id: n.id, s: scoreNote(n, lq), u: n.updated_at }))
    .filter(({ s }) => s > 0)
    .sort((a, b) => b.s - a.s || b.u - a.u)
    .map(({ id }) => id);
}

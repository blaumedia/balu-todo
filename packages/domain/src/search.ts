// Lightweight local search over the replica for the ⌘K command palette.
// No fuzzy-search dependency: exact / word-prefix / subsequence scoring only,
// shared so every client ranks results identically.

import type { Label, Project, Task } from "./types.js";

export type SearchKind = "task" | "project" | "label";

export interface SearchItem {
  kind: SearchKind;
  id: string;
  /** Primary display text (task title, project/label name). */
  text: string;
  score: number;
}

export interface SearchInput {
  /** Open + completed tasks (callers pass everything not soft-deleted). */
  tasks: ReadonlyArray<Task>;
  projects: ReadonlyArray<Project>;
  labels: ReadonlyArray<Label>;
}

// Score tiers keep exact > prefix > word-prefix > substring > subsequence and
// leave head-room so an earlier match position still ranks within its tier.
const EXACT = 1000;
const PREFIX = 800;
const WORD_PREFIX = 600;
const SUBSTRING = 400;
const SUBSEQUENCE = 200;

function isWordBoundary(ch: string): boolean {
  return ch === " " || ch === "-" || ch === "_" || ch === "/" || ch === "." || ch === ",";
}

/** Ordered-subsequence check with a compactness bonus, or null if no match. */
function subsequenceScore(query: string, text: string): number | null {
  let qi = 0;
  let firstAt = -1;
  let lastAt = -1;
  for (let ti = 0; ti < text.length && qi < query.length; ti += 1) {
    if (text[ti] === query[qi]) {
      if (firstAt < 0) firstAt = ti;
      lastAt = ti;
      qi += 1;
    }
  }
  if (qi < query.length) return null;
  const span = lastAt - firstAt + 1;
  // Tighter spans (closer to query length) score higher; earlier start helps too.
  return SUBSEQUENCE + Math.max(0, 80 - (span - query.length)) - firstAt;
}

/**
 * Score one candidate string against a normalized query. Higher is better;
 * `null` means no match. Considers the field's own words for word-prefix hits.
 */
export function scoreText(query: string, text: string): number | null {
  const t = text.toLowerCase();
  const q = query;
  if (!q) return 0;
  if (t === q) return EXACT;
  const idx = t.indexOf(q);
  if (idx === 0) return PREFIX - 0;
  if (idx > 0) {
    const wordStart = isWordBoundary(t[idx - 1]!);
    return (wordStart ? WORD_PREFIX : SUBSTRING) - idx;
  }
  return subsequenceScore(q, t);
}

/**
 * Rank tasks (title + notes), projects and labels for `query`.
 * Returns up to `limit` items, best first. Soft-deleted objects should be
 * filtered out by the caller before passing them in.
 */
export function searchItems(query: string, input: SearchInput, limit = 20): SearchItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: SearchItem[] = [];

  for (const task of input.tasks) {
    if (task.is_deleted) continue;
    const titleScore = scoreText(q, task.title);
    // Notes match is weaker than a title match of the same tier.
    const notesScore = task.notes ? scoreText(q, task.notes) : null;
    let score: number | null = titleScore;
    if (score == null && notesScore != null) score = notesScore - 300;
    if (score != null) out.push({ kind: "task", id: task.id, text: task.title, score });
  }

  for (const project of input.projects) {
    if (project.is_deleted) continue;
    const score = scoreText(q, project.name);
    if (score != null) out.push({ kind: "project", id: project.id, text: project.name, score });
  }

  for (const label of input.labels) {
    if (label.is_deleted) continue;
    const score = scoreText(q, label.name);
    if (score != null) out.push({ kind: "label", id: label.id, text: label.name, score });
  }

  out.sort((a, b) => b.score - a.score || a.text.localeCompare(b.text));
  return out.slice(0, limit);
}

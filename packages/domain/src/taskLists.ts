// Smart-list predicates + orderings — the shared client/server truth from
// contract §4. Every client renders lists through `selectList`.

import type { IsoDate, SmartList, Task } from "./types.js";
import { compareISO } from "./dates.js";

/** open = not completed and not deleted (contract §4). */
export function isOpen(t: Task): boolean {
  return t.completed_at == null && !t.is_deleted;
}

// Subtasks never appear in smart lists independently in v1 (contract §4 note).
const isTopLevel = (t: Task): boolean => t.parent_task_id == null;

export function isInbox(t: Task, _today: IsoDate): boolean {
  return isOpen(t) && t.project_id == null && !t.someday && isTopLevel(t);
}

export function isToday(t: Task, today: IsoDate): boolean {
  if (!isOpen(t) || t.someday || !isTopLevel(t)) return false;
  const startDue = t.start_date != null && t.start_date <= today;
  const deadlineDue = t.deadline != null && t.deadline <= today;
  return startDue || deadlineDue;
}

export function isUpcoming(t: Task, today: IsoDate): boolean {
  if (!isOpen(t) || !isTopLevel(t)) return false;
  const startFuture = t.start_date != null && t.start_date > today;
  const deadlineFuture = t.deadline != null && t.deadline > today;
  return startFuture || deadlineFuture;
}

export function isAnytime(t: Task, _today: IsoDate): boolean {
  return (
    isOpen(t) &&
    !t.someday &&
    t.start_date == null &&
    t.project_id != null &&
    isTopLevel(t)
  );
}

export function isSomeday(t: Task, _today: IsoDate): boolean {
  return isOpen(t) && t.someday && isTopLevel(t);
}

export function isLogbook(t: Task, _today: IsoDate): boolean {
  return t.completed_at != null && !t.is_deleted && isTopLevel(t);
}

/**
 * "Assigned to me" (contract §4, v1.2): open ∧ `assigned_to == current user`.
 * Subtasks never surface independently (top-level only, like every smart list).
 */
export function isAssignedToMe(t: Task, userId: string | null | undefined): boolean {
  return isOpen(t) && isTopLevel(t) && userId != null && t.assigned_to === userId;
}

// The date-based predicates; `assigned` is handled separately (it needs userId).
const PREDICATES: Record<Exclude<SmartList, "assigned">, (t: Task, today: IsoDate) => boolean> = {
  inbox: isInbox,
  today: isToday,
  upcoming: isUpcoming,
  anytime: isAnytime,
  someday: isSomeday,
  logbook: isLogbook,
};

export function matchesList(
  t: Task,
  list: SmartList,
  today: IsoDate,
  userId?: string | null,
): boolean {
  if (list === "assigned") return isAssignedToMe(t, userId);
  return PREDICATES[list](t, today);
}

// ── Ordering ──────────────────────────────────────────────────────────

/** Priority rank: P1 < P2 < P3 < none. */
function priorityRank(p: number): number {
  return p === 0 ? 4 : p;
}

/** The date an Upcoming task is grouped under: earliest of its future dates. */
export function upcomingGroupDate(t: Task, today: IsoDate): IsoDate | null {
  const candidates: IsoDate[] = [];
  if (t.start_date != null && t.start_date > today) candidates.push(t.start_date);
  if (t.deadline != null && t.deadline > today) candidates.push(t.deadline);
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (a <= b ? a : b));
}

/**
 * Today ordering (contract §4): overdue-deadline first, then evening last,
 * then priority (1<2<3<0), then sort_order.
 */
function compareToday(a: Task, b: Task, today: IsoDate): number {
  const overdue = (t: Task) => (t.deadline != null && t.deadline < today ? 0 : 1);
  const evening = (t: Task) => (t.evening ? 1 : 0);
  return (
    overdue(a) - overdue(b) ||
    evening(a) - evening(b) ||
    priorityRank(a.priority) - priorityRank(b.priority) ||
    a.sort_order - b.sort_order
  );
}

function compareUpcoming(a: Task, b: Task, today: IsoDate): number {
  const da = upcomingGroupDate(a, today);
  const db = upcomingGroupDate(b, today);
  if (da && db) {
    const c = compareISO(da, db);
    if (c !== 0) return c;
  } else if (da) return -1;
  else if (db) return 1;
  return a.sort_order - b.sort_order;
}

/**
 * Assigned-to-me ordering (contract §4): deadline ascending with nulls last,
 * then priority (1<2<3<0), then sort_order.
 */
function compareAssigned(a: Task, b: Task): number {
  const da = a.deadline;
  const db = b.deadline;
  if (da != null && db != null) {
    const c = compareISO(da, db);
    if (c !== 0) return c;
  } else if (da != null) return -1; // a has a deadline, b doesn't → a first
  else if (db != null) return 1;
  return priorityRank(a.priority) - priorityRank(b.priority) || a.sort_order - b.sort_order;
}

function compareAnytime(a: Task, b: Task): number {
  // Approximation of "project order": group by project id, then sort_order.
  // Views iterate projects in their real sort order for the visible grouping.
  const pa = a.project_id ?? "";
  const pb = b.project_id ?? "";
  if (pa !== pb) return pa < pb ? -1 : 1;
  return a.sort_order - b.sort_order;
}

/**
 * Filter `tasks` to `list` and return them sorted per contract §4.
 * Grouped lists (Upcoming, Logbook) are returned flat but pre-sorted so the
 * view only has to slice on the grouping key.
 */
export function selectList(
  tasks: ReadonlyArray<Task>,
  list: SmartList,
  today: IsoDate,
  userId?: string | null,
): Task[] {
  const filtered = tasks.filter((t) => matchesList(t, list, today, userId));
  switch (list) {
    case "today":
      filtered.sort((a, b) => compareToday(a, b, today));
      break;
    case "upcoming":
      filtered.sort((a, b) => compareUpcoming(a, b, today));
      break;
    case "assigned":
      filtered.sort(compareAssigned);
      break;
    case "anytime":
      filtered.sort(compareAnytime);
      break;
    case "logbook":
      filtered.sort((a, b) => {
        const ca = a.completed_at ?? "";
        const cb = b.completed_at ?? "";
        return ca < cb ? 1 : ca > cb ? -1 : 0; // desc
      });
      break;
    case "inbox":
    case "someday":
    default:
      filtered.sort((a, b) => a.sort_order - b.sort_order);
      break;
  }
  return filtered;
}

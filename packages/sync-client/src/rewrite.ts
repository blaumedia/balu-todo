// temp_id → real id rewriting (contract §6.6) for both the replica and the
// still-queued commands.

import type { SyncCommand } from "@balu/domain";
import type { Replica } from "./replica.js";

type Mapping = Record<string, string>;

const map = (mapping: Mapping, v: string | null): string | null =>
  v != null && mapping[v] != null ? mapping[v] : v;

export function rewriteReplicaRefs(replica: Replica, mapping: Mapping): void {
  for (const s of replica.sections.values()) {
    s.project_id = map(mapping, s.project_id) ?? s.project_id;
  }
  for (const t of replica.tasks.values()) {
    t.project_id = map(mapping, t.project_id);
    t.section_id = map(mapping, t.section_id);
    t.parent_task_id = map(mapping, t.parent_task_id);
    t.assigned_to = map(mapping, t.assigned_to);
    if (t.label_ids.length) t.label_ids = t.label_ids.map((l) => mapping[l] ?? l);
  }
  // A comment created against a not-yet-synced task references it by temp_id.
  for (const c of replica.comments.values()) {
    c.task_id = map(mapping, c.task_id) ?? c.task_id;
  }
}

const ID_KEYS = ["id", "project_id", "section_id", "parent_task_id", "assigned_to", "task_id"];

export function rewriteCommandRefs(commands: SyncCommand[], mapping: Mapping): void {
  for (const cmd of commands) {
    const a = cmd.args;
    for (const k of ID_KEYS) {
      const v = a[k];
      if (typeof v === "string" && mapping[v] != null) a[k] = mapping[v];
    }
    if (Array.isArray(a["label_ids"])) {
      a["label_ids"] = (a["label_ids"] as string[]).map((l) => mapping[l] ?? l);
    }
    if (Array.isArray(a["items"])) {
      for (const it of a["items"] as Array<{ id?: string }>) {
        if (typeof it.id === "string" && mapping[it.id] != null) it.id = mapping[it.id];
      }
    }
  }
}

export function removeTempEntries(replica: Replica, mapping: Mapping): void {
  for (const temp of Object.keys(mapping)) {
    replica.projects.delete(temp);
    replica.sections.delete(temp);
    replica.tasks.delete(temp);
    replica.labels.delete(temp);
    replica.comments.delete(temp);
    replica.members.delete(temp);
  }
}

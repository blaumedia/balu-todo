import type { Attachment, Comment, Label, Member, Project, Section, Task } from "@balu/domain";

export interface Replica {
  projects: Map<string, Project>;
  sections: Map<string, Section>;
  tasks: Map<string, Task>;
  labels: Map<string, Label>;
  comments: Map<string, Comment>;
  attachments: Map<string, Attachment>;
  members: Map<string, Member>;
}

export function emptyReplica(): Replica {
  return {
    projects: new Map(),
    sections: new Map(),
    tasks: new Map(),
    labels: new Map(),
    comments: new Map(),
    attachments: new Map(),
    members: new Map(),
  };
}

export interface SerializedReplica {
  projects: Project[];
  sections: Section[];
  tasks: Task[];
  labels: Label[];
  comments: Comment[];
  attachments: Attachment[];
  members: Member[];
}

export function serializeReplica(r: Replica): SerializedReplica {
  return {
    projects: [...r.projects.values()],
    sections: [...r.sections.values()],
    tasks: [...r.tasks.values()],
    labels: [...r.labels.values()],
    comments: [...r.comments.values()],
    attachments: [...r.attachments.values()],
    members: [...r.members.values()],
  };
}

export function hydrateReplica(data: SerializedReplica): Replica {
  const r = emptyReplica();
  for (const p of data.projects ?? []) r.projects.set(p.id, p);
  for (const s of data.sections ?? []) r.sections.set(s.id, s);
  for (const t of data.tasks ?? []) r.tasks.set(t.id, t);
  for (const l of data.labels ?? []) r.labels.set(l.id, l);
  for (const c of data.comments ?? []) r.comments.set(c.id, c);
  // `?? []` is not decoration: a replica persisted by a pre-v1.4 client has no
  // `attachments` key at all, and hydrating one must not throw.
  for (const a of data.attachments ?? []) r.attachments.set(a.id, a);
  for (const m of data.members ?? []) r.members.set(m.id, m);
  return r;
}

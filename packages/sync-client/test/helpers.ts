import type { Comment, Project, Task } from "@balu/domain";

let seq = 0;
export function makeTask(over: Partial<Task> & { id: string }): Task {
  seq += 1;
  return {
    workspace_id: "w1",
    project_id: null,
    section_id: null,
    parent_task_id: null,
    title: `Task ${seq}`,
    notes: "",
    start_date: null,
    evening: false,
    someday: false,
    deadline: null,
    reminder_at: null,
    recurrence: null,
    priority: 0,
    label_ids: [],
    assigned_to: null,
    sort_order: 1000,
    completed_at: null,
    completed_by: null,
    created_by: "u1",
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    is_deleted: false,
    ...over,
  };
}

export function makeProject(over: Partial<Project> & { id: string }): Project {
  return {
    workspace_id: "w1",
    name: "Project",
    color: "blue",
    sort_order: 1000,
    archived_at: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    is_deleted: false,
    ...over,
  };
}

export function makeComment(over: Partial<Comment> & { id: string }): Comment {
  return {
    workspace_id: "w1",
    task_id: "t1",
    author_id: "u1",
    body: "comment",
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    is_deleted: false,
    ...over,
  };
}

/**
 * A minimal in-memory sync server: resolves temp_ids, echoes created objects,
 * and records every request body so tests can assert batching / rewrites.
 */
export function makeServer() {
  const calls: Array<{ sync_token: string; commands: any[] }> = [];
  const tempMap: Record<string, string> = {};
  let counter = 0;
  let version = 0;

  const fetchImpl = async (_url: any, init: any): Promise<Response> => {
    const req = JSON.parse(init.body);
    calls.push(req);
    const mapping: Record<string, string> = {};
    const objects: any = { projects: [], sections: [], tasks: [], labels: [], comments: [], members: [] };

    for (const cmd of req.commands ?? []) {
      const args = { ...(cmd.args ?? {}) };
      for (const k of ["project_id", "section_id", "parent_task_id", "id", "assigned_to", "task_id"]) {
        if (typeof args[k] === "string" && tempMap[args[k]]) args[k] = tempMap[args[k]];
      }
      if (cmd.type === "project_add") {
        const real = `P${++counter}`;
        tempMap[cmd.temp_id] = real;
        mapping[cmd.temp_id] = real;
        objects.projects.push(makeProject({ id: real, name: args.name }));
      } else if (cmd.type === "task_add") {
        const real = `T${++counter}`;
        tempMap[cmd.temp_id] = real;
        mapping[cmd.temp_id] = real;
        objects.tasks.push(makeTask({ id: real, title: args.title, project_id: args.project_id ?? null }));
      } else if (cmd.type === "comment_add") {
        const real = `C${++counter}`;
        tempMap[cmd.temp_id] = real;
        mapping[cmd.temp_id] = real;
        objects.comments.push(makeComment({ id: real, task_id: args.task_id ?? null, body: args.body }));
      }
    }

    version += 1;
    const resp = {
      sync_token: `v${version}`,
      full_sync: false,
      sync_status: {},
      temp_id_mapping: mapping,
      ...objects,
    };
    return new Response(JSON.stringify(resp), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  return { calls, fetch: fetchImpl as unknown as typeof fetch };
}

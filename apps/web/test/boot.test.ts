import { beforeEach, describe, expect, it, vi } from "vitest";

// boot.ts owns the recovery from a lost workspace; clients.ts (sync client,
// localStorage, api) is replaced by a small fake so the flows run in node.
const fake = vi.hoisted(() => {
  const state = {
    open: null as string | null,
    stored: [] as string[],
    discarded: new Map<string, number>(),
    expected: new Set<string>(),
    announced: new Set<string>(),
    purged: [] as string[],
    getMe: (async () => ({})) as () => Promise<any>,
  };
  return state;
});

vi.mock("../src/lib/clients.js", () => ({
  api: { getMe: () => fake.getMe() },
  initSync: (id: string) => {
    fake.open = id;
  },
  getSyncWorkspaceId: () => fake.open,
  listStoredWorkspaceIds: () => fake.stored,
  purgeWorkspaceStorage: async (id: string) => {
    fake.purged.push(id);
    return fake.discarded.get(id) ?? 0;
  },
  claimAccessLossNotice: (id: string) => {
    if (fake.expected.has(id) || fake.announced.has(id)) return false;
    fake.announced.add(id);
    return true;
  },
  setAccessLostHandler: () => {},
}));

import { discardLostWorkspaces, handleAccessLost, moveOffLostWorkspace } from "../src/lib/boot.js";
import { useApp } from "../src/store/app.js";

const user = { id: "u1", name: "U", email: "u@x", locale: "en" } as any;
const ws = (id: string) => ({ id, name: `WS ${id}` }) as any;
const mem = (id: string) => ({ workspace: ws(id), role: "owner" }) as any;

function me(...ids: string[]) {
  return { user, memberships: ids.map(mem) };
}

beforeEach(() => {
  fake.open = "lost";
  fake.stored = [];
  fake.discarded.clear();
  fake.expected.clear();
  fake.announced.clear();
  fake.purged = [];
  fake.getMe = async () => me("a", "b");
  useApp.setState({
    user,
    memberships: [mem("lost"), mem("a"), mem("b")],
    workspace: ws("lost"),
    toast: null,
    locale: "en",
  });
});

describe("handleAccessLost", () => {
  it("announces the loss with the count and moves to a survivor", async () => {
    await handleAccessLost({ workspaceId: "lost", reason: "removed", discarded: 3 });
    expect(useApp.getState().toast).toContain("3 unsynced change(s)");
    expect(fake.open).toBe("a");
    expect(useApp.getState().workspace?.id).toBe("a");
    expect(fake.purged).toContain("lost");
  });

  it("an expected loss shows no notice but still moves off the workspace", async () => {
    fake.expected.add("lost");
    await handleAccessLost({ workspaceId: "lost", reason: "deleted", discarded: 0 });
    expect(useApp.getState().toast).toBeNull();
    expect(fake.open).toBe("a");
  });

  it("a stale client's loss does not move the app", async () => {
    fake.open = "b";
    useApp.setState({ workspace: ws("b") });
    await handleAccessLost({ workspaceId: "lost", reason: "removed", discarded: 1 });
    expect(fake.open).toBe("b");
    expect(useApp.getState().workspace?.id).toBe("b");
  });
});

describe("moveOffLostWorkspace", () => {
  it("keeps a workspace the user switched to while /me was in flight", async () => {
    let answer: (v: unknown) => void = () => {};
    fake.getMe = () => new Promise((r) => (answer = r));
    const moving = moveOffLostWorkspace("lost");
    fake.open = "b"; // the user switches meanwhile
    useApp.setState({ workspace: ws("b") });
    answer(me("a", "b"));
    await moving;
    expect(fake.open).toBe("b");
    expect(useApp.getState().workspace?.id).toBe("b");
    expect(fake.purged).toEqual(["lost"]);
  });

  it("concurrent calls share one move", async () => {
    let calls = 0;
    fake.getMe = async () => {
      calls += 1;
      return me("a");
    };
    await Promise.all([moveOffLostWorkspace("lost"), moveOffLostWorkspace("lost")]);
    expect(calls).toBe(1);
  });
});

describe("discardLostWorkspaces", () => {
  it("cleans every stored workspace /me no longer lists and announces once", async () => {
    fake.stored = ["a", "gone1", "gone2"];
    fake.discarded.set("gone1", 2);
    fake.discarded.set("gone2", 5);
    await discardLostWorkspaces(["a", "b"]);
    expect(fake.purged).toEqual(["gone1", "gone2"]);
    const toast = useApp.getState().toast ?? "";
    expect(toast).toContain("2 unsynced change(s)");
    expect(toast).toContain("5 unsynced change(s)");
    // A second pass finds nothing new to announce.
    useApp.setState({ toast: null });
    await discardLostWorkspaces(["a", "b"]);
    expect(useApp.getState().toast).toBeNull();
  });

  it("says nothing when the lost workspaces held no unsynced changes", async () => {
    fake.stored = ["gone"];
    await discardLostWorkspaces(["a"]);
    expect(fake.purged).toEqual(["gone"]);
    expect(useApp.getState().toast).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

// The real clients.ts (retired set, retire(), teardownSyncSettled()) with a fake
// sync client whose storage write and request are separately controllable.
const fakes = vi.hoisted(() => ({
  made: [] as Array<{
    workspaceId: string;
    closed: boolean;
    stopped: boolean;
    finishWrite: () => void;
    releaseRequest: () => void;
    writesSettledCalls: number;
    idleCalls: number;
  }>,
}));

vi.mock('react-native', () => ({ Alert: { alert: () => {} } }));
vi.mock('../src/lib/kv', () => ({
  SETTINGS: { knownWorkspaces: 'knownWorkspaces' },
  sqliteKV: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
}));
vi.mock('@balu/sync-client', () => ({
  purgeWorkspaceData: async () => 0,
  createSyncClient: (opts: { workspaceId: string }) => {
    let finishWrite: () => void = () => {};
    let releaseRequest: () => void = () => {};
    const write = new Promise<void>((r) => {
      finishWrite = r;
    });
    const request = new Promise<void>((r) => {
      releaseRequest = r;
    });
    const rec = {
      workspaceId: opts.workspaceId,
      closed: false,
      stopped: false,
      finishWrite,
      releaseRequest,
      writesSettledCalls: 0,
      idleCalls: 0,
    };
    fakes.made.push(rec);
    return {
      start: () => {},
      stop: () => {
        rec.stopped = true;
      },
      close: () => {
        rec.closed = true;
        rec.stopped = true;
      },
      // idle() waits for the (possibly slow) request, writesSettled() only for the write.
      idle: async () => {
        rec.idleCalls += 1;
        await Promise.all([write, request]);
      },
      writesSettled: async () => {
        rec.writesSettledCalls += 1;
        await write;
      },
    };
  },
}));

import { initApi, initSync, teardownSync, teardownSyncSettled, getSync } from '../src/lib/clients';

const URL = 'https://balu.example';

beforeEach(() => {
  initApi(URL);
  fakes.made.length = 0;
});

async function reset(): Promise<void> {
  const pending = teardownSyncSettled();
  for (const c of fakes.made) c.finishWrite();
  await pending;
  fakes.made.length = 0;
}

describe('teardownSyncSettled reaches stopped clients', () => {
  it('a client stopped by a workspace switch is closed by a later teardown', async () => {
    initSync(URL, 'w1', 'u1');
    initSync(URL, 'w2', 'u1'); // w1 stopped, still winding down
    const [w1, w2] = fakes.made;
    expect(w1!.stopped).toBe(true);
    expect(w1!.closed).toBe(false);
    const pending = teardownSyncSettled();
    expect(w1!.closed).toBe(true);
    expect(w2!.closed).toBe(true);
    expect(getSync()).toBeNull();
    w1!.finishWrite();
    w2!.finishWrite();
    await pending;
    fakes.made.length = 0;
  });

  it('a client stopped by teardownSync is closed too', async () => {
    initSync(URL, 'w1', 'u1');
    teardownSync(); // session expiry
    const [w1] = fakes.made;
    expect(w1!.closed).toBe(false);
    const pending = teardownSyncSettled();
    expect(w1!.closed).toBe(true);
    w1!.finishWrite();
    await pending;
  });

  it('does not resolve before every started write settled, but not for a hanging request', async () => {
    initSync(URL, 'w1', 'u1');
    initSync(URL, 'w2', 'u1');
    const [w1, w2] = fakes.made;
    let done = false;
    const pending = teardownSyncSettled().then(() => {
      done = true;
    });
    w1!.finishWrite();
    await new Promise((r) => setTimeout(r, 5));
    expect(done).toBe(false); // w2's write is still running
    w2!.finishWrite();
    await pending; // the requests of both never answered
    expect(done).toBe(true);
  });

  it('forgets a stopped client once its work has settled', async () => {
    initSync(URL, 'w1', 'u1');
    teardownSync();
    const [w1] = fakes.made;
    w1!.finishWrite();
    w1!.releaseRequest();
    await new Promise((r) => setTimeout(r, 5));
    await teardownSyncSettled();
    expect(w1!.closed).toBe(false); // settled and dropped: nothing left to close
  });

  it('switching back to a workspace closes its stopped client', async () => {
    initSync(URL, 'w1', 'u1');
    initSync(URL, 'w2', 'u1');
    initSync(URL, 'w1', 'u1');
    const [oldW1, w2, newW1] = fakes.made;
    expect(oldW1!.closed).toBe(true);
    expect(w2!.closed).toBe(false);
    expect(newW1!.closed).toBe(false);
    await reset();
  });
});

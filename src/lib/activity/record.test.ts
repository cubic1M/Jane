import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db-scoped", () => ({ scopedFor: vi.fn() }));

import { scopedFor } from "@/lib/db-scoped";
import { recordActivity, recordingFor } from "./record";

const createMany = vi.fn();
const client = { activityEvent: { createMany } } as never;
const at = Date.now() - 1_000;

// What the person has linked: Plaid item ids, and how many CSV accounts.
function linked(itemIds: string[], csvAccounts = 0) {
  vi.mocked(scopedFor).mockReturnValue({
    plaidItems: { findMany: vi.fn(async () => itemIds.map((plaidItemId) => ({ plaidItemId }))) },
    accounts: { count: vi.fn(async () => csvAccounts) },
  } as never);
}

const body = {
  visitId: "visit12345",
  events: [
    { kind: "page_view", path: "/", at },
    { kind: "page_view", path: "/home", at },
    { kind: "click", path: "/home", at, role: "button", label: "Cancel Netflix" },
  ],
};

describe("who the activity log records", () => {
  beforeEach(() => {
    createMany.mockReset();
    linked([]);
  });

  it("records a real signed-in beta user, before and after they link a bank", async () => {
    expect(await recordingFor({ id: "user_1", role: "user" }, { client })).toBe("user");
    linked(["item-real-1"]);
    expect(await recordingFor({ id: "user_1", role: "user" }, { client })).toBe("user");
  });

  it("never records a trial person, an admin or a demo-bank person", async () => {
    expect(await recordingFor({ id: "trial_abc", role: "user" }, { client })).toBe("none");
    expect(await recordingFor({ id: "admin_1", role: "admin" }, { client })).toBe("none");
    linked(["demo-item-1"]);
    expect(await recordingFor({ id: "user_2", role: "user" }, { client })).toBe("none");
  });

  it("records a demo-bank person once they add real data", async () => {
    linked(["demo-item-1"], 1);
    expect(await recordingFor({ id: "user_2", role: "user" }, { client })).toBe("user");
    linked(["demo-item-1", "item-real-1"]);
    expect(await recordingFor({ id: "user_2", role: "user" }, { client })).toBe("user");
  });

  it("treats someone signed out as anonymous", async () => {
    expect(await recordingFor(null, { client })).toBe("anonymous");
  });
});

describe("recordActivity", () => {
  beforeEach(() => {
    createMany.mockReset();
    linked([]);
  });

  it("stores every event of a beta user under their id", async () => {
    const result = await recordActivity({ id: "user_1", role: "user" }, body, { client });
    expect(result).toEqual({ ok: true, recording: "user", stored: 3 });
    const rows = createMany.mock.calls[0][0].data;
    expect(rows.map((r: { userId: string; kind: string }) => [r.userId, r.kind])).toEqual([
      ["user_1", "page_view"],
      ["user_1", "page_view"],
      ["user_1", "click"],
    ]);
  });

  it("stores only an anonymous view of the landing page before sign-in", async () => {
    const result = await recordActivity(null, body, { client });
    expect(result).toEqual({ ok: true, recording: "anonymous", stored: 1 });
    expect(createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ userId: null, kind: "page_view", path: "/" }),
    ]);
  });

  it("stores nothing for a trial person or an admin", async () => {
    for (const person of [
      { id: "trial_abc", role: "user" },
      { id: "admin_1", role: "admin" },
    ]) {
      expect(await recordActivity(person, body, { client })).toEqual({
        ok: true,
        recording: "none",
        stored: 0,
      });
    }
    expect(createMany).not.toHaveBeenCalled();
  });

  it("says when the body isn't a batch", async () => {
    expect(await recordActivity(null, { nope: true }, { client })).toEqual({ ok: false });
  });
});

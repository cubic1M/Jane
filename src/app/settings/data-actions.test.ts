import { beforeEach, describe, expect, it, vi } from "vitest";

const { findFirst, afterCallbacks } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  afterCallbacks: [] as (() => unknown)[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({
  after: vi.fn((callback: () => unknown) => afterCallbacks.push(callback)),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/detection/engine", () => ({ runDetection: vi.fn() }));
vi.mock("@/lib/account-deletion", () => ({ deleteAllData: vi.fn() }));
vi.mock("@/lib/plaid/sync", () => ({ syncItem: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ hit: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/db-scoped", () => ({
  scopedFor: vi.fn(() => ({ plaidItems: { findFirst: findFirst } })),
}));
vi.mock("@/lib/plaid/remove", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/plaid/remove")>()),
  removePlaidItem: vi.fn(),
}));

import { runDetection } from "@/detection/engine";
import { deleteAllData } from "@/lib/account-deletion";
import { ItemMissingError, removePlaidItem } from "@/lib/plaid/remove";
import { syncItem } from "@/lib/plaid/sync";
import { hit } from "@/lib/rate-limit";
import { deleteMyData, disconnectBank, refreshBank } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("deleteMyData", () => {
  beforeEach(() => vi.mocked(deleteAllData).mockReset());

  it("needs DELETE typed exactly", async () => {
    for (const confirm of ["", "delete", "DELETE "]) {
      expect(await deleteMyData(null, form({ confirm }))).toMatchObject({ ok: false });
    }
    expect(deleteAllData).not.toHaveBeenCalled();
  });

  it("deletes the signed-in person's data and says goodbye", async () => {
    await expect(deleteMyData(null, form({ confirm: "DELETE" }))).rejects.toThrow(
      "redirect:/goodbye",
    );
    expect(deleteAllData).toHaveBeenCalledWith("u1");
  });
});

describe("disconnectBank", () => {
  beforeEach(() => {
    vi.mocked(removePlaidItem).mockReset();
    vi.mocked(runDetection).mockReset();
  });

  it("removes the bank, answers at once, and refreshes findings after", async () => {
    afterCallbacks.length = 0;
    expect(await disconnectBank(null, form({ itemId: "item1" }))).toMatchObject({ ok: true });
    expect(removePlaidItem).toHaveBeenCalledWith("u1", "item1", "user_disconnected");
    expect(runDetection).not.toHaveBeenCalled();
    for (const callback of afterCallbacks) await callback();
    expect(runDetection).toHaveBeenCalledWith("u1");
  });

  it("refuses an item the person doesn't have", async () => {
    vi.mocked(removePlaidItem).mockRejectedValue(new ItemMissingError());
    expect(await disconnectBank(null, form({ itemId: "x" }))).toMatchObject({ ok: false });
    expect(runDetection).not.toHaveBeenCalled();
  });
});

describe("refreshBank", () => {
  beforeEach(() => {
    findFirst.mockReset().mockResolvedValue({ id: "item1" });
    vi.mocked(syncItem)
      .mockReset()
      .mockResolvedValue({ added: 3 } as never);
    vi.mocked(hit)
      .mockReset()
      .mockResolvedValue({ ok: true } as never);
  });

  it("syncs the person's own bank and says what changed", async () => {
    expect(await refreshBank(null, form({ itemId: "item1" }))).toEqual({
      ok: true,
      message: "Updated: 3 new transactions.",
    });
    expect(syncItem).toHaveBeenCalledWith("item1");
  });

  it("refuses someone else's bank and is rate limited", async () => {
    findFirst.mockResolvedValue(null);
    expect(await refreshBank(null, form({ itemId: "x" }))).toMatchObject({ ok: false });

    vi.mocked(hit).mockResolvedValue({ ok: false } as never);
    expect(await refreshBank(null, form({ itemId: "item1" }))).toMatchObject({
      ok: false,
      message: expect.stringContaining("refreshed a lot"),
    });
    expect(syncItem).not.toHaveBeenCalled();
  });
});

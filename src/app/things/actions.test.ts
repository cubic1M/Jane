import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/owned-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/owned-assets")>()),
  addAsset: vi.fn(),
  updateAsset: vi.fn(),
  removeAsset: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { AssetError, addAsset, removeAsset, updateAsset } from "@/lib/owned-assets";
import { deleteAsset, saveAsset } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};
const fields = {
  kind: "home",
  name: "Our house",
  value: "450000",
  valuedOn: "2026-09-01",
  loanAccountId: "loan1",
};

describe("things you own actions", () => {
  beforeEach(() => vi.mocked(revalidatePath).mockClear());

  it("adds for the signed-in person and goes back with a confirmation", async () => {
    await expect(saveAsset(null, form(fields))).rejects.toThrow("REDIRECT /things?saved=added");
    expect(addAsset).toHaveBeenCalledWith("u1", fields);
    // The other pages that count it are refreshed; /things itself loads fresh.
    expect(revalidatePath).toHaveBeenCalledWith("/net-worth");
    expect(revalidatePath).not.toHaveBeenCalledWith("/things");
  });

  it("updates when there's an id", async () => {
    await expect(saveAsset(null, form({ ...fields, assetId: "a1" }))).rejects.toThrow(
      "REDIRECT /things?saved=updated",
    );
    expect(updateAsset).toHaveBeenCalledWith("u1", "a1", fields);
  });

  it("shows a problem as a message and keeps what was typed", async () => {
    vi.mocked(addAsset).mockRejectedValueOnce(new AssetError("Enter what it's worth."));
    expect(await saveAsset(null, form({ ...fields, value: "lots" }))).toEqual({
      message: "Enter what it's worth.",
      input: { ...fields, value: "lots" },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("passes other errors on", async () => {
    vi.mocked(addAsset).mockRejectedValueOnce(new Error("database down"));
    await expect(saveAsset(null, form(fields))).rejects.toThrow("database down");
  });

  it("removes for the signed-in person", async () => {
    await expect(deleteAsset(form({ assetId: "a1" }))).rejects.toThrow(
      "REDIRECT /things?saved=removed",
    );
    expect(removeAsset).toHaveBeenCalledWith("u1", "a1");
  });

  it("goes back quietly when there's nothing of theirs to remove", async () => {
    vi.mocked(removeAsset).mockRejectedValueOnce(new AssetError("That isn't one of yours."));
    await expect(deleteAsset(form({ assetId: "nope" }))).rejects.toThrow("REDIRECT /things");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

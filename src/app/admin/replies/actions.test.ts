import { beforeEach, describe, expect, it, vi } from "vitest";

const { create, update, deleteMany } = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { savedReply: { create, update, deleteMany } } }));

import { logAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/session";
import { deleteReply, saveReply } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("saved replies", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin)
      .mockReset()
      .mockResolvedValue({ id: "admin_1", role: "admin" } as never);
    create.mockReset().mockResolvedValue({ id: "r1" });
    deleteMany.mockReset().mockResolvedValue({ count: 1 });
    vi.mocked(logAudit).mockReset();
  });

  it("is admin-only", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("notFound"));
    await expect(saveReply(null, form({ title: "t", body: "b" }))).rejects.toThrow("notFound");
    await expect(deleteReply(form({ id: "r1" }))).rejects.toThrow("notFound");
  });

  it("saves a reply and logs it", async () => {
    expect(
      await saveReply(
        null,
        form({ title: "Need a statement", body: "Please upload last month's statement." }),
      ),
    ).toEqual({ ok: true, message: "Saved." });
    expect(logAudit).toHaveBeenCalledWith(
      { type: "admin", id: "admin_1" },
      "saved_reply_saved",
      { type: "saved_reply", id: "r1" },
      {},
    );
  });

  it("refuses an empty reply", async () => {
    expect(await saveReply(null, form({ title: "t", body: "" }))).toMatchObject({ ok: false });
    expect(create).not.toHaveBeenCalled();
  });

  it("deletes and logs", async () => {
    await deleteReply(form({ id: "r1" }));
    expect(logAudit).toHaveBeenCalledWith(
      { type: "admin", id: "admin_1" },
      "saved_reply_deleted",
      { type: "saved_reply", id: "r1" },
      {},
    );
  });
});

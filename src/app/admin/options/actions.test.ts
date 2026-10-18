import { beforeEach, describe, expect, it, vi } from "vitest";

const { create, updateMany, deleteMany } = vi.hoisted(() => ({
  create: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { switchOption: { create, updateMany, deleteMany } } }));

import { logAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/session";
import { markChecked, removeOption, saveOption } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

const PLAN = {
  kind: "plan",
  category: "phone",
  provider: "Pine Mobile",
  name: "Pine Unlimited",
  monthly: "35",
  sourceUrl: "https://pine.example/plans",
  reviewed: "on",
};

describe("options on /admin/options", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin)
      .mockReset()
      .mockResolvedValue({ id: "admin_1", role: "admin" } as never);
    create.mockReset().mockResolvedValue({ id: "opt_1" });
    updateMany.mockReset().mockResolvedValue({ count: 1 });
    deleteMany.mockReset().mockResolvedValue({ count: 1 });
    vi.mocked(logAudit).mockReset();
  });

  it("is admin-only", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("notFound"));
    await expect(saveOption(null, form(PLAN))).rejects.toThrow("notFound");
    await expect(markChecked(form({ id: "opt_1" }))).rejects.toThrow("notFound");
    await expect(removeOption(form({ id: "opt_1" }))).rejects.toThrow("notFound");
    expect(create).not.toHaveBeenCalled();
  });

  it("adds a checked option and logs it", async () => {
    expect(await saveOption(null, form(PLAN))).toEqual({
      ok: true,
      message: "Added Pine Unlimited.",
    });
    expect(create.mock.calls[0][0].data).toMatchObject({ monthlyCents: 3_500 });
    expect(logAudit).toHaveBeenCalledWith(
      { type: "admin", id: "admin_1" },
      "switch_option_saved",
      { type: "switch_option", id: "opt_1" },
      { kind: "plan", reviewed: true },
    );
  });

  it("returns the problem without saving", async () => {
    expect(await saveOption(null, form({ ...PLAN, monthly: "" }))).toMatchObject({ ok: false });
    expect(create).not.toHaveBeenCalled();
  });

  it("marks a price checked today, and never touches demo examples", async () => {
    await markChecked(form({ id: "opt_1" }));
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "opt_1", demo: false },
      data: { checkedAt: expect.any(Date), reviewedAt: expect.any(Date) },
    });
    await removeOption(form({ id: "opt_1" }));
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: "opt_1", demo: false } });
    expect(logAudit).toHaveBeenCalledTimes(2);
  });
});

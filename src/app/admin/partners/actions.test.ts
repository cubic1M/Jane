import { beforeEach, describe, expect, it, vi } from "vitest";

const { create, update, updateMany } = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { referralPartner: { create, update, updateMany } } }));

import { logAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/session";
import { savePartner, turnOffPartner } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};
const valid = {
  key: "example-bank",
  name: "Example Bank",
  actionType: "move_idle_cash",
  disclosure: "We may earn a referral fee.",
  referralUrl: "https://example.com/r",
  allowedStates: "CA",
  revenuePerConversion: "40",
  active: "on",
};

describe("partner actions", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin)
      .mockReset()
      .mockResolvedValue({ id: "admin_1", role: "admin" } as never);
    create.mockReset().mockResolvedValue({ id: "p1" });
    updateMany.mockReset().mockResolvedValue({ count: 1 });
    vi.mocked(logAudit).mockReset();
  });

  it("is admin-only", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("notFound"));
    await expect(savePartner(null, form(valid))).rejects.toThrow("notFound");
    await expect(turnOffPartner(form({ id: "p1" }))).rejects.toThrow("notFound");
    expect(create).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("adds a partner and logs it", async () => {
    expect(await savePartner(null, form(valid))).toEqual({
      ok: true,
      message: "Saved Example Bank.",
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ key: "example-bank", allowedStates: ["CA"], active: true }),
      select: { id: true },
    });
    expect(logAudit).toHaveBeenCalled();
  });

  it("refuses a partner with no disclosure", async () => {
    expect(await savePartner(null, form({ ...valid, disclosure: "" }))).toMatchObject({
      ok: false,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("turns a partner off at once", async () => {
    await turnOffPartner(form({ id: "p1" }));
    expect(updateMany).toHaveBeenCalledWith({ where: { id: "p1" }, data: { active: false } });
  });
});

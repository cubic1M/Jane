import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";

const { create, update } = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { merchant: { create, update } } }));

import { logAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/session";
import { saveMerchant } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("saveMerchant", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin)
      .mockReset()
      .mockResolvedValue({ id: "admin_1", role: "admin" } as never);
    create.mockReset().mockResolvedValue({ id: "m1" });
    update.mockReset().mockResolvedValue({ id: "m1" });
    vi.mocked(logAudit).mockReset();
  });

  it("is admin-only", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("notFound"));
    await expect(saveMerchant(null, form({ name: "X" }))).rejects.toThrow("notFound");
    expect(create).not.toHaveBeenCalled();
  });

  it("adds a merchant, marks it reviewed, and logs it", async () => {
    expect(await saveMerchant(null, form({ name: "Streamflix", reviewed: "on" }))).toEqual({
      ok: true,
      message: "Saved Streamflix.",
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ key: "streamflix", reviewedAt: expect.any(Date) }),
      select: { id: true },
    });
    expect(logAudit).toHaveBeenCalledWith(
      { type: "admin", id: "admin_1" },
      "merchant_saved",
      { type: "merchant", id: "m1" },
      { key: "streamflix" },
    );
  });

  it("updates by id, and says so when the key is taken", async () => {
    await saveMerchant(null, form({ id: "m1", name: "Streamflix" }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "m1" } }));

    create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }),
    );
    expect(await saveMerchant(null, form({ name: "Netflix" }))).toMatchObject({ ok: false });
  });

  it("returns validation messages without saving", async () => {
    expect(await saveMerchant(null, form({ name: "" }))).toMatchObject({ ok: false });
    expect(create).not.toHaveBeenCalled();
  });
});

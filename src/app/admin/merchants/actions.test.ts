import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";

const { create, update, findUnique } = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { merchant: { create, update, findUnique } } }));
vi.mock("@/lib/agent/run", () => ({ resumeForMerchant: vi.fn(async () => 0) }));

import { resumeForMerchant } from "@/lib/agent/run";
import { logAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/session";
import { confirmSuggestion, saveMerchant } from "./actions";

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

describe("saving a support email", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin)
      .mockReset()
      .mockResolvedValue({ id: "admin_1", role: "admin" } as never);
    create.mockReset().mockResolvedValue({ id: "m1" });
    update.mockReset().mockResolvedValue({ id: "m1" });
    vi.mocked(resumeForMerchant).mockReset().mockResolvedValue(0);
  });

  it("picks up the requests that were waiting for it", async () => {
    vi.mocked(resumeForMerchant).mockResolvedValue(2);
    const saved = await saveMerchant(
      null,
      form({ name: "Streamflix", supportEmail: "help@streamflix.com" }),
    );
    expect(resumeForMerchant).toHaveBeenCalledWith("Streamflix");
    expect(saved?.message).toContain("picked up 2 waiting requests");
  });

  it("doesn't resume anything without one", async () => {
    await saveMerchant(null, form({ name: "Streamflix" }));
    expect(resumeForMerchant).not.toHaveBeenCalled();
  });
});

describe("confirmSuggestion", () => {
  const suggested = {
    id: "m1",
    name: "Streamflix",
    suggestedSupportEmail: "help@streamflix.com",
  };
  beforeEach(() => {
    vi.mocked(requireAdmin)
      .mockReset()
      .mockResolvedValue({ id: "admin_1", role: "admin" } as never);
    update.mockReset().mockResolvedValue({ id: "m1" });
    findUnique.mockReset().mockResolvedValue(suggested);
    vi.mocked(resumeForMerchant).mockReset().mockResolvedValue(0);
    vi.mocked(logAudit).mockReset();
  });

  it("is admin-only", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("notFound"));
    await expect(confirmSuggestion(form({ id: "m1", accept: "yes" }))).rejects.toThrow("notFound");
    expect(update).not.toHaveBeenCalled();
  });

  it("on yes, uses the address and resumes the waiting requests", async () => {
    await confirmSuggestion(form({ id: "m1", accept: "yes" }));
    expect(update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: expect.objectContaining({
        supportEmail: "help@streamflix.com",
        suggestedSupportEmail: null,
      }),
    });
    expect(resumeForMerchant).toHaveBeenCalledWith("Streamflix");
    expect(logAudit).toHaveBeenCalledWith(
      { type: "admin", id: "admin_1" },
      "support_contact_confirmed",
      { type: "merchant", id: "m1" },
      { accepted: true },
    );
  });

  it("on no, drops the suggestion and keeps the directory as it was", async () => {
    await confirmSuggestion(form({ id: "m1", accept: "no" }));
    const data = update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("supportEmail");
    expect(data.suggestedSupportEmail).toBeNull();
    expect(resumeForMerchant).not.toHaveBeenCalled();
  });

  it("does nothing when there's no suggestion", async () => {
    findUnique.mockResolvedValue({ ...suggested, suggestedSupportEmail: null });
    await confirmSuggestion(form({ id: "m1", accept: "yes" }));
    expect(update).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  hit: vi.fn(async () => ({ ok: true, remaining: 1, retryAfterSeconds: 0 })),
}));
vi.mock("@/lib/invites", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/invites")>()),
  createInviteCode: vi.fn(),
  revokeInviteCode: vi.fn(),
}));

import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { hit } from "@/lib/rate-limit";
import { createInviteCode, revokeInviteCode } from "@/lib/invites";
import { requireAdmin } from "@/lib/session";
import { createInvite, revokeInvite } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("the invite admin actions", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin)
      .mockReset()
      .mockResolvedValue({ id: "admin_1", role: "admin" } as never);
    vi.mocked(createInviteCode)
      .mockReset()
      .mockResolvedValue({ id: "inv_1", code: "ABCD-EFGH-JKMN" });
    vi.mocked(revokeInviteCode).mockReset().mockResolvedValue({ id: "inv_1" });
    vi.mocked(logAudit).mockReset();
    vi.mocked(track).mockReset();
  });

  it("are admin-only", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("notFound"));
    await expect(createInvite(null, form({ maxUses: "1" }))).rejects.toThrow("notFound");
    await expect(revokeInvite(form({ code: "ABCD-EFGH-JKMN" }))).rejects.toThrow("notFound");
    expect(createInviteCode).not.toHaveBeenCalled();
    expect(revokeInviteCode).not.toHaveBeenCalled();
  });

  it("makes a code locked to an email, saying who made it, audited without the email", async () => {
    const state = await createInvite(
      null,
      form({ maxUses: "1", email: " Friend@Example.com ", note: "Sam's friend" }),
    );
    expect(state).toEqual({ ok: true, message: "Created ABCD-EFGH-JKMN", code: "ABCD-EFGH-JKMN" });
    expect(createInviteCode).toHaveBeenCalledWith({
      maxUses: 1,
      note: "Sam's friend",
      expiresAt: null,
      email: "Friend@Example.com",
      createdById: "admin_1",
    });
    expect(logAudit).toHaveBeenCalledWith(
      { type: "admin", id: "admin_1" },
      "invite_code_created",
      { type: "invite_code", id: "inv_1" },
      { uses: 1, lockedToEmail: true, expires: false },
    );
    expect(JSON.stringify(vi.mocked(logAudit).mock.calls)).not.toContain("Friend@");
    expect(track).toHaveBeenCalledWith("admin_1", "invite_created", {
      uses: 1,
      locked_to_email: true,
    });
  });

  it("makes only so many codes an hour per admin", async () => {
    vi.mocked(hit).mockResolvedValueOnce({ ok: false, remaining: 0, retryAfterSeconds: 60 });
    expect(await createInvite(null, form({ maxUses: "1" }))).toMatchObject({ ok: false });
    expect(hit).toHaveBeenCalledWith("invites", "admin_1");
    expect(createInviteCode).not.toHaveBeenCalled();
  });

  it("refuses bad uses and a bad email", async () => {
    expect(await createInvite(null, form({ maxUses: "0" }))).toMatchObject({ ok: false });
    expect(await createInvite(null, form({ maxUses: "1", email: "nope" }))).toMatchObject({
      ok: false,
    });
    expect(createInviteCode).not.toHaveBeenCalled();
  });

  it("revokes a code once, audited", async () => {
    await revokeInvite(form({ code: "abcd efgh jkmn" }));
    expect(revokeInviteCode).toHaveBeenCalledWith("ABCD-EFGH-JKMN");
    expect(logAudit).toHaveBeenCalledWith({ type: "admin", id: "admin_1" }, "invite_code_revoked", {
      type: "invite_code",
      id: "inv_1",
    });
    expect(track).toHaveBeenCalledWith("admin_1", "invite_revoked", {});

    vi.mocked(revokeInviteCode).mockResolvedValue(null);
    vi.mocked(logAudit).mockClear();
    await revokeInvite(form({ code: "ABCD-EFGH-JKMN" }));
    expect(logAudit).not.toHaveBeenCalled();
  });
});

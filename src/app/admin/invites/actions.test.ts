import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  hit: vi.fn(async () => ({ ok: true, remaining: 1, retryAfterSeconds: 0 })),
}));
vi.mock("@/lib/invite-email", () => ({ emailInvite: vi.fn() }));
vi.mock("@/lib/invites", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/invites")>()),
  createInviteCode: vi.fn(),
  revokeInviteCode: vi.fn(),
}));

import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { hit } from "@/lib/rate-limit";
import { emailInvite } from "@/lib/invite-email";
import { createInviteCode, revokeInviteCode } from "@/lib/invites";
import { requireAdmin } from "@/lib/session";
import { createInvite, revokeInvite, sendInvite } from "./actions";
import { form } from "@/lib/__fixtures__/form";

describe("the invite admin actions", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin)
      .mockReset()
      .mockResolvedValue({ id: "admin_1", role: "admin", email: "founder@example.test" } as never);
    vi.mocked(emailInvite).mockReset().mockResolvedValue({ result: "sent", id: "inv_1" });
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
    await expect(sendInvite(form({ code: "ABCD-EFGH-JKMN" }))).rejects.toThrow("notFound");
    expect(createInviteCode).not.toHaveBeenCalled();
    expect(emailInvite).not.toHaveBeenCalled();
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

  it("emails a new code to its one address when asked, audited by id, replies going to the founder", async () => {
    const state = await createInvite(
      null,
      form({ maxUses: "1", email: "student@example.edu", send: "on" }),
    );
    expect(state).toEqual({
      ok: true,
      message: "Created ABCD-EFGH-JKMN. Emailed it.",
      code: "ABCD-EFGH-JKMN",
    });
    expect(emailInvite).toHaveBeenCalledWith("ABCD-EFGH-JKMN", {
      replyTo: "founder@example.test",
    });
    expect(logAudit).toHaveBeenCalledWith({ type: "admin", id: "admin_1" }, "invite_code_emailed", {
      type: "invite_code",
      id: "inv_1",
    });
    expect(JSON.stringify(vi.mocked(logAudit).mock.calls)).not.toContain("student@");
  });

  it("never emails a code for anyone, and says when the email didn't go", async () => {
    await createInvite(null, form({ maxUses: "5", send: "on" }));
    expect(emailInvite).not.toHaveBeenCalled();

    vi.mocked(emailInvite).mockResolvedValue({ result: "failed", id: "inv_1" });
    const state = await createInvite(
      null,
      form({ maxUses: "1", email: "student@example.edu", send: "on" }),
    );
    expect(state).toMatchObject({ ok: false, code: "ABCD-EFGH-JKMN" });
    expect(state?.message).toContain("didn't send");
    expect(logAudit).not.toHaveBeenCalledWith(
      expect.anything(),
      "invite_code_emailed",
      expect.anything(),
    );
  });

  it("emails an existing code again from the list", async () => {
    await sendInvite(form({ code: "abcd-efgh-jkmn" }));
    expect(emailInvite).toHaveBeenCalledWith("ABCD-EFGH-JKMN", {
      replyTo: "founder@example.test",
    });
    vi.mocked(emailInvite).mockClear();
    await sendInvite(form({ code: "not a code" }));
    expect(emailInvite).not.toHaveBeenCalled();
  });
});

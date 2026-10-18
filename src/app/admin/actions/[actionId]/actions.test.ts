import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    action: { findUnique: vi.fn() },
    referralPartner: { findUnique: vi.fn() },
    referralConversion: { create: vi.fn() },
  },
}));
vi.mock("@/lib/drafts", () => ({ draftMessage: vi.fn() }));
vi.mock("@/lib/concierge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/concierge")>()),
  changeActionStatus: vi.fn(),
}));

import { ConciergeError, changeActionStatus } from "@/lib/concierge";
import { requireAdmin } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { draftMessage } from "@/lib/drafts";
import { draftForAction, recordConversion, updateAction } from "./actions";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

describe("updateAction", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin)
      .mockReset()
      .mockResolvedValue({ id: "admin_1", role: "admin" } as never);
    vi.mocked(changeActionStatus).mockReset();
  });

  it("is admin-only", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("notFound"));

    await expect(updateAction(null, form({ actionId: "a1", status: "done" }))).rejects.toThrow(
      "notFound",
    );
    expect(changeActionStatus).not.toHaveBeenCalled();
  });

  it("passes the form through, with blanks as null and minutes as a number", async () => {
    const result = await updateAction(
      null,
      form({ actionId: "a1", status: "done", minutesSpent: "15", notes: "  ", assignee: "sam" }),
    );

    expect(result).toEqual({ ok: true, message: expect.stringContaining("Saved") });
    expect(changeActionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: "admin_1" }),
      "a1",
      {
        status: "done",
        assignee: "sam",
        notes: null,
        userTodo: null,
        failureReason: null,
        minutesSpent: 15,
      },
    );
  });

  it("shows the queue rule that blocked the change", async () => {
    vi.mocked(changeActionStatus).mockRejectedValue(new ConciergeError("Enter the minutes spent."));

    expect(await updateAction(null, form({ actionId: "a1", status: "done" }))).toEqual({
      ok: false,
      message: "Enter the minutes spent.",
    });
  });

  it("rejects an unknown status", async () => {
    expect(await updateAction(null, form({ actionId: "a1", status: "archived" }))).toEqual({
      ok: false,
      message: "Pick a status.",
    });
  });
});

describe("draftForAction", () => {
  const finding = { type: "duplicate_charge", evidence: {} };
  beforeEach(() => {
    vi.mocked(requireAdmin)
      .mockReset()
      .mockResolvedValue({ id: "admin_1", role: "admin" } as never);
    vi.mocked(db.action.findUnique)
      .mockReset()
      .mockResolvedValue({
        id: "a1",
        userId: "u1",
        type: "request_refund",
        decision: { finding },
      } as never);
    vi.mocked(draftMessage)
      .mockReset()
      .mockResolvedValue({
        kind: "llm",
        draft: { channel: "email", subject: "s", body: "b" },
        model: "m",
      });
    vi.mocked(logAudit).mockReset();
  });

  it("is admin-only", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("notFound"));
    await expect(draftForAction(null, form({ actionId: "a1" }))).rejects.toThrow("notFound");
    expect(draftMessage).not.toHaveBeenCalled();
  });

  it("drafts from the action's finding and records it in the audit log", async () => {
    expect(await draftForAction(null, form({ actionId: "a1" }))).toEqual({
      ok: true,
      draft: { channel: "email", subject: "s", body: "b" },
      byClaude: true,
    });
    expect(draftMessage).toHaveBeenCalledWith("request_refund", finding);
    expect(logAudit).toHaveBeenCalledWith(
      { type: "admin", id: "admin_1" },
      "admin_drafted_message",
      { type: "action", id: "a1" },
      { user_id: "u1", source: "llm" },
    );
  });

  it("says so when there's nothing to draft or no such action", async () => {
    vi.mocked(draftMessage).mockResolvedValue(null);
    expect(await draftForAction(null, form({ actionId: "a1" }))).toMatchObject({ ok: false });
    vi.mocked(db.action.findUnique).mockResolvedValue(null);
    expect(await draftForAction(null, form({ actionId: "x" }))).toMatchObject({ ok: false });
  });
});

describe("recordConversion", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin)
      .mockReset()
      .mockResolvedValue({ id: "admin_1", role: "admin" } as never);
    vi.mocked(db.action.findUnique)
      .mockReset()
      .mockResolvedValue({
        id: "a1",
        userId: "u1",
        decision: {
          cardSnapshot: { referralPartner: { key: "example-bank", name: "Example Bank" } },
        },
      } as never);
    vi.mocked(db.referralPartner.findUnique)
      .mockReset()
      .mockResolvedValue({ id: "p1" } as never);
    vi.mocked(db.referralConversion.create)
      .mockReset()
      .mockResolvedValue({ id: "c1", amountCents: 4_000 } as never);
  });

  it("records revenue against the partner the card used", async () => {
    expect(await recordConversion(null, form({ actionId: "a1", amount: "$40" }))).toEqual({
      ok: true,
      message: "Recorded.",
    });
    expect(db.referralConversion.create).toHaveBeenCalledWith({
      data: { partnerId: "p1", userId: "u1", actionId: "a1", amountCents: 4_000 },
      select: { id: true, amountCents: true },
    });
  });

  it("refuses an action without a partner, or a bad amount", async () => {
    expect(await recordConversion(null, form({ actionId: "a1", amount: "zero" }))).toMatchObject({
      ok: false,
    });
    vi.mocked(db.action.findUnique).mockResolvedValue({
      id: "a1",
      userId: "u1",
      decision: { cardSnapshot: { referralPartner: null } },
    } as never);
    expect(await recordConversion(null, form({ actionId: "a1", amount: "40" }))).toMatchObject({
      ok: false,
    });
    expect(db.referralConversion.create).not.toHaveBeenCalled();
  });
});

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

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { recordConversion } from "./actions";

// Revenue can't be recorded from an insurance partner whose card told the person Jane isn't paid
// for it (PAY_DISCLOSURES.none), nor from one paid per policy sold (connectors roadmap round 14).

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("recording a referral's revenue", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockResolvedValue({ id: "admin_1", role: "admin" } as never);
    vi.mocked(db.action.findUnique).mockResolvedValue({
      id: "a1",
      userId: "u1",
      decision: { cardSnapshot: { referralPartner: { key: "example-insurance" } } },
    } as never);
    vi.mocked(db.referralConversion.create)
      .mockReset()
      .mockResolvedValue({ id: "c1", amountCents: 6_000 } as never);
  });

  it("is refused for an unpaid or per-sale insurance partner", async () => {
    for (const payModel of ["none", "per_policy"]) {
      vi.mocked(db.referralPartner.findUnique).mockResolvedValue({
        id: "p1",
        actionType: "insurance_reshop",
        payModel,
      } as never);
      expect(await recordConversion(null, form({ actionId: "a1", amount: "60" }))).toMatchObject({
        ok: false,
      });
    }
    expect(db.referralConversion.create).not.toHaveBeenCalled();
  });

  it("is kept for a flat-fee insurance partner", async () => {
    vi.mocked(db.referralPartner.findUnique).mockResolvedValue({
      id: "p1",
      actionType: "insurance_reshop",
      payModel: "flat_lead",
    } as never);
    expect(await recordConversion(null, form({ actionId: "a1", amount: "20" }))).toMatchObject({
      ok: true,
    });
  });
});

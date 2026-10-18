import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { balanceFor } from "./shared-bills";

describe("balanceFor", () => {
  const charges = [
    { payerId: "ana", amountCents: 10_000, partnerShareBps: 5_000 }, // Ben owes Ana $50
    { payerId: "ben", amountCents: 3_000, partnerShareBps: 5_000 }, // Ana owes Ben $15
    { payerId: "ana", amountCents: 999, partnerShareBps: 3_333 }, // Ben owes Ana $3.33
  ];

  it("is the same balance seen from either side", () => {
    expect(balanceFor("ana", charges, [])).toBe(5_000 - 1_500 + 333);
    expect(balanceFor("ben", charges, [])).toBe(-(5_000 - 1_500 + 333));
  });

  it("goes to zero once settled", () => {
    const owed = balanceFor("ana", charges, []);
    const settlement = { fromUserId: "ben", toUserId: "ana", amountCents: owed };
    expect(balanceFor("ana", charges, [settlement])).toBe(0);
    expect(balanceFor("ben", charges, [settlement])).toBe(0);
  });
});

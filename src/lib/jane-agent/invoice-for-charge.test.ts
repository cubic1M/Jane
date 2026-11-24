import { describe, expect, it, vi } from "vitest";
import type { DetectionTransaction } from "@/detection/types";

// An October $20, then Nov 20: A $100, B $50 and C $100, all Vercel (CodeRabbit's example).
const lines: DetectionTransaction[] = [
  ["o", "2026-10-20", 2_000],
  ["A", "2026-11-20", 10_000],
  ["B", "2026-11-20", 5_000],
  ["C", "2026-11-20", 10_000],
].map(([id, date, cents]) => ({
  id: String(id),
  accountId: "a1",
  plaidTransactionId: null,
  date: String(date),
  amountCents: Number(cents),
  description: "VERCEL INC",
  merchantName: "Vercel",
  pfcPrimary: null,
  pfcDetailed: null,
  categorySource: null,
}));
vi.mock("@/detection/input", () => ({
  loadDetectionInput: vi.fn(async () => ({ transactions: lines })),
}));

import { loadChargeExplanation } from "./invoice-for-charge";

// The invoice page's charge is the transaction the link names, not another that looks like it.

describe("loadChargeExplanation", () => {
  it("explains the first of two same-day $100 charges, not the last", async () => {
    const a = await loadChargeExplanation("u1", "A");
    expect(a?.charge.id).toBe("A");
    expect(a?.usual?.cents).toBe(2_000);
    expect(a?.differenceCents).toBe(8_000);
  });

  it("explains each by its own id", async () => {
    expect((await loadChargeExplanation("u1", "C"))?.charge.id).toBe("C");
    expect((await loadChargeExplanation("u1", "B"))?.charge.id).toBe("B");
  });

  it("explains nothing for an id that isn't one of their charges", async () => {
    expect(await loadChargeExplanation("u1", "nope")).toBeNull();
  });
});

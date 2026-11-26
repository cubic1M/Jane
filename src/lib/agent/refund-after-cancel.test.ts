import { describe, expect, it, vi } from "vitest";

// The automatic refund asks for the card's hash the way recordDecision builds it, with the
// referral partner, or the request is refused as "card changed" and skipped in silence
// (CodeRabbit sweep part 2, chunk act-03b).

const buildCard = vi.fn((_finding: unknown, partner?: unknown) => ({ partner }));
const record = vi.fn(async () => ({ decisionId: "d1" }));
vi.mock("@/lib/cards", () => ({
  ACTION_FOR_FINDING: { charge_after_cancel: "request_refund" },
  CARD_SELECT: { id: true },
  buildCard: (...args: [unknown, unknown?]) => buildCard(...args),
  cardHash: (card: { partner?: unknown }) => `hash:${JSON.stringify(card.partner ?? null)}`,
}));
vi.mock("@/lib/concierge-mode", () => ({ conciergeMode: async () => true }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db-scoped", () => ({
  scopedFor: () => ({
    findings: { findMany: async () => [{ id: "f1", type: "charge_after_cancel" }] },
  }),
}));
vi.mock("@/lib/decisions", () => ({
  DecisionError: class DecisionError extends Error {},
  recordDecision: (...args: unknown[]) => (record as (...a: unknown[]) => unknown)(...args),
}));
vi.mock("@/lib/referrals", () => ({ partnerForUser: async () => ({ name: "Partner Co" }) }));

import { refundChargesAfterCancel } from "./refund-after-cancel";

describe("refundChargesAfterCancel", () => {
  it("hashes the card with the person's referral partner, as the decision does", async () => {
    await refundChargesAfterCancel("u1", { client: {} as never });
    expect(record).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ cardHash: 'hash:{"name":"Partner Co"}' }),
      expect.anything(),
    );
  });
});

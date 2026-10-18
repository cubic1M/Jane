import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { MERCHANT_SEED } from "@/config/merchant-seed";
import { computeOutcomes, describeOutcome, type FinishedAction } from "./merchant-outcomes";

const action = (overrides: Partial<FinishedAction> = {}): FinishedAction => ({
  merchantName: "Netflix",
  actionType: "cancel_subscription",
  status: "done",
  minutesSpent: 10,
  ...overrides,
});

describe("computeOutcomes", () => {
  it("counts cases, successes and median minutes per merchant and action", () => {
    expect(
      computeOutcomes(
        [
          action({ minutesSpent: 8 }),
          action({ minutesSpent: 12 }),
          action({ merchantName: "NETFLIX.COM", minutesSpent: 30 }),
          action({ status: "failed", minutesSpent: 60 }),
          action({ actionType: "request_refund", minutesSpent: 20 }),
        ],
        MERCHANT_SEED,
      ),
    ).toEqual([
      {
        merchantKey: "netflix",
        actionType: "cancel_subscription",
        cases: 4,
        succeeded: 3,
        medianMinutes: 12,
      },
      {
        merchantKey: "netflix",
        actionType: "request_refund",
        cases: 1,
        succeeded: 1,
        medianMinutes: 20,
      },
    ]);
  });

  it("joins a merchant's statement names through the directory", () => {
    const [row] = computeOutcomes(
      [action({ merchantName: "Spotify USA" }), action({ merchantName: "Spotify" })],
      MERCHANT_SEED,
    );
    expect(row).toMatchObject({ merchantKey: "spotify", cases: 2 });
  });

  it("ignores actions that don't happen at a merchant, and unnamed ones", () => {
    expect(
      computeOutcomes(
        [action({ actionType: "move_idle_cash" }), action({ merchantName: null })],
        MERCHANT_SEED,
      ),
    ).toEqual([]);
  });

  it("describes an outcome plainly", () => {
    expect(
      describeOutcome({
        merchantKey: "netflix",
        actionType: "cancel_subscription",
        cases: 8,
        succeeded: 7,
        medianMinutes: 10,
      }),
    ).toBe("usually about 10 minutes; 7 of 8 worked");
  });
});

describe("merchant_outcomes table", () => {
  it("holds no user or action ids", () => {
    const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
    const model = schema.match(/model MerchantOutcome \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(model).not.toBe("");
    expect(model).not.toMatch(/userId|user_id|actionId|User\b|Action\b/);
  });
});

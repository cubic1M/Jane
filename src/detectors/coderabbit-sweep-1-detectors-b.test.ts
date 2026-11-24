import { describe, expect, it } from "vitest";
import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";
import { TAX_DETECTORS } from "./taxes";

// CodeRabbit sweep, part 1 (money figures): the Marketplace repayment warning is not worked out
// from months the data doesn't have.

describe("the Marketplace repayment warning needs the months it is worked out from", () => {
  const sam = (change: (d: ReturnType<typeof inputFor>) => ReturnType<typeof inputFor>) => {
    const data = change(inputFor("freelancer"));
    return runDetectors({ profile: buildProfile(data), data }, TAX_DETECTORS).map((s) => s.topic);
  };
  it("is raised from a full year of history", () => {
    expect(sam((d) => d)).toContain("ptc_repayment");
  });
  it("is not raised when the history starts after January and no advance was told", () => {
    const late = (d: ReturnType<typeof inputFor>) => ({
      ...d,
      transactions: d.transactions.filter((t) => t.date >= `${d.today.slice(0, 4)}-04-01`),
    });
    expect(sam(late)).not.toContain("ptc_repayment");
  });
  it("still uses an advance the person told, whenever the history starts", () => {
    const late = (d: ReturnType<typeof inputFor>) => ({
      ...d,
      told: { ...d.told, marketplace_aptc_monthly: 15_000 },
      transactions: d.transactions.filter((t) => t.date >= `${d.today.slice(0, 4)}-04-01`),
    });
    expect(Array.isArray(sam(late))).toBe(true);
  });
});

describe("the Marketplace check reads this year's months only", () => {
  it("is not raised when only last December precedes April", () => {
    const data = inputFor("freelancer");
    const year = Number(data.today.slice(0, 4));
    const late = {
      ...data,
      transactions: [
        ...data.transactions.filter((t) => t.date >= `${year}-04-01`),
        {
          date: `${year - 1}-12-15`,
          amountCents: 100,
          description: "COFFEE",
          pfc: null,
          accountId: data.accounts[0]!.id,
        },
      ],
    };
    const topics = runDetectors({ profile: buildProfile(late), data: late }, TAX_DETECTORS).map(
      (s) => s.topic,
    );
    expect(topics).not.toContain("ptc_repayment");
  });
});

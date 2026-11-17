import { describe, expect, it } from "vitest";
import type { CardInterest } from "@/lib/card-interest";
import { cardInterestReply } from "./card-interest-replies";

// Debug 2, fourth desktop sweep (11-17, Plaid sandbox default user): "how much did I pay in
// interest?" answered "I don't see any card interest in your accounts…" though the student loan's
// lender reported $3,119.50 paid this year. The year's interest each lender reports is said too.

const noPartner = { available: false } as unknown as CardInterest;
const student = { name: "Plaid student ····4000", ytdCents: 311_950 };

describe("how much was paid in interest", () => {
  it("says what a lender reports, with no card interest", () => {
    expect(cardInterestReply(noPartner, null, [student]).body).toBe(
      "I don't see any card interest in your accounts. Paying each card in full every month keeps it that way. Your lender reports $3,119.50 on Plaid student ····4000 in interest paid this year.",
    );
  });

  it("says it beside card interest too", () => {
    const body = cardInterestReply(
      noPartner,
      {
        findingId: "f1",
        title: "$353.31 in interest on Capital One card in the last 12 months",
        yearlyCents: 35_331,
      },
      [student, { name: "Plaid auto ····5000", ytdCents: 41_200 }],
    ).body;
    expect(body).toMatch(/^You paid \$353\.31 in interest on Capital One card/);
    expect(body).toMatch(
      /Your lenders report \$3,119\.50 on Plaid student ····4000 and \$412\.00 on Plaid auto ····5000 in interest paid this year\.$/,
    );
  });

  it("says nothing more without a lender's figure", () => {
    expect(cardInterestReply(noPartner).body).toBe(
      "I don't see any card interest in your accounts. Paying each card in full every month keeps it that way.",
    );
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { feeSummary, feeYear } from "@/insights/investment-fees";
import type { InvestmentAccountView } from "@/insights/investments";
import type { AdvisoryView } from "@/lib/investments/costly-products";
import { advisoryLine } from "./costly-copy";
import { costlyReply, feesReply } from "./replies";

// #2186 ends a year of investment fees at the newest investment line, so over data that stopped on
// Oct 23 the "last 12 months" of fees is the year to Oct 23. Said as "the last 12 months" beside a
// figure that old, it reads as now (manager, 11-20). Like the estimated balance naming its statement
// day, the fees name their year's end when it's past STALE_AFTER_DAYS.

const account = {
  id: "brokerage",
  name: "Brokerage",
  subtype: "brokerage",
  balanceCents: 1_000_000,
  holdings: [],
} as unknown as InvestmentAccountView;
const fees = (yearTo: string | null) => ({
  ...feeSummary(
    [account],
    [
      { accountId: "brokerage", subtype: "management fee", amountCents: 12_480 },
      { accountId: "brokerage", subtype: "account fee", amountCents: 5_000 },
    ],
  ),
  yearTo,
});
const advisory = (yearTo: string | null): AdvisoryView => ({
  yearlyCents: 12_480,
  assetsCents: 1_000_000,
  feeBps: 125,
  lowCostYearlyCents: 300,
  gap: { years: 30, lowCents: 100_000, highCents: 200_000 },
  yearTo,
});
const costly = (yearTo: string | null) =>
  costlyReply({ advice: false, demo: false, products: [], asked: [], advisory: advisory(yearTo) })
    .body;

describe("a year of fees from data that stopped long ago", () => {
  it("says the year to its end day", () => {
    expect(feeYear({ yearTo: "2026-10-23" })).toBe("the year to Oct 23");
    expect(feesReply(fees("2026-10-23"), false).body).toContain(
      "The advisory and account fees are from the year to Oct 23, where your investment records end.",
    );
    expect(costly("2026-10-23")).toContain("advisory fees: $124.80 in the year to Oct 23");
    expect(advisoryLine(advisory("2026-10-23"))).toContain(
      "in advisory fees in the year to Oct 23",
    );
  });

  it("never says the last 12 months beside an old end day", () => {
    for (const text of [
      feesReply(fees("2026-10-23"), false).body,
      costly("2026-10-23"),
      advisoryLine(advisory("2026-10-23")),
    ]) {
      expect(text).not.toMatch(/last 12 months/i);
    }
  });

  it("says the last 12 months, as now, when the data is current", () => {
    expect(feeYear({ yearTo: null })).toBe("the last 12 months");
    expect(feesReply(fees(null), false).body).not.toMatch(/year to|records end/);
    expect(costly(null)).toContain("advisory fees: $124.80 in the last 12 months");
  });

  it("leaves no fixed 'last 12 months' beside a fee figure on the pages or in the chat", () => {
    for (const file of [
      "src/app/investments/fees/body.tsx",
      "src/app/investments/costly-products/page.tsx",
      "src/lib/jane-agent/investments/costly-copy.ts",
      "src/lib/jane-agent/investments/replies.ts",
    ]) {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (/^\s*\/\//.test(line)) continue;
        if (/fee/i.test(line)) expect(line, file).not.toMatch(/last 12 months/i);
      }
    }
  });
});

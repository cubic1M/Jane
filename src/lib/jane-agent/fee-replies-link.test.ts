import { describe, expect, it } from "vitest";
import { FEE_LIST_PATH } from "@/detectors/bank-fees-of";
import { feesPaidReply, refundsReply, waiverReply, type FeeContext } from "./replies-fees";

// The backup chat's fee answers open the fee list, as the bank-fees card does since #2222
// (manager 11-23): "See the fees" opened Insights, and "See your spending" Spending, pages that list
// categories, not the fees the answer named.

const line = (date: string, amountCents: number, description: string, pfc: string | null) => ({
  date,
  amountCents,
  description,
  merchantName: null,
  pfcDetailed: pfc,
  accountId: "chk",
});
const ctx = (lines: FeeContext["lines"]): FeeContext => ({
  asOf: "2026-11-20",
  lines,
  accounts: new Map([["chk", { name: "Wells Fargo checking", cash: true }]]),
  waiver: null,
});
const MONTHLY = line("2026-10-31", 1_000, "MONTHLY SERVICE FEE", "BANK_FEES_OTHER_BANK_FEES");
const hrefs = (r: { actions: { kind: string; href?: string }[] }) =>
  r.actions.filter((a) => a.kind === "link").map((a) => a.href);

describe("the fee answers' buttons", () => {
  it("open the fee list, with fees and without", () => {
    for (const lines of [[MONTHLY], []]) {
      expect(hrefs(feesPaidReply(false, 3, ctx(lines)))).toEqual([FEE_LIST_PATH]);
      expect(hrefs(waiverReply(ctx(lines)))).toEqual([FEE_LIST_PATH]);
      expect(hrefs(refundsReply(ctx(lines), 30))).toEqual([FEE_LIST_PATH]);
    }
  });

  it("keep the waiver card's own page when Jane raised one", () => {
    const withCard = { ...ctx([MONTHLY]), waiver: { why: "…", href: "https://bank.example/fees" } };
    expect(hrefs(waiverReply(withCard))).toEqual(["https://bank.example/fees"]);
  });
});

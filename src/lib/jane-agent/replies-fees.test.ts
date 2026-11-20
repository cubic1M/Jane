import { describe, expect, it } from "vitest";
import {
  chargeReply,
  feesPaidReply,
  waiverReply,
  type FeeContext,
  type FeeLine,
} from "./replies-fees";

// The backup chat's fee answers (./replies-fees.ts), on the walkers' own cases.

const line = (
  date: string,
  amountCents: number,
  description: string,
  pfc: string | null,
  accountId = "chk",
): FeeLine => ({
  date,
  amountCents,
  description,
  merchantName: null,
  pfcDetailed: pfc,
  accountId,
});

const ctx = (lines: FeeLine[], waiver: FeeContext["waiver"] = null): FeeContext => ({
  asOf: "2026-11-20",
  lines,
  accounts: new Map([
    ["chk", { name: "Chase checking", cash: true }],
    ["card", { name: "Capital One card", cash: false }],
  ]),
  waiver,
});

const NSF = line(
  "2026-11-02",
  3_400,
  "INSUFFICIENT FUNDS FEE FOR A $16.40 ITEM - DETAILS: SAFEWAY",
  "BANK_FEES_INSUFFICIENT_FUNDS",
);
const SAFEWAY = line("2026-11-02", 1_640, "SAFEWAY #1234 BERKELEY CA", "FOOD_AND_DRINK_GROCERIES");
const MONTHLY = ["2026-09-28", "2026-10-28", "2026-08-28"].map((d) =>
  line(d, 1_200, "MONTHLY MAINTENANCE FEE", "BANK_FEES_OTHER_BANK_FEES"),
);

describe("a charge by its amount", () => {
  it("says what a fee is, what it was for, and that a first one is often refunded (upload S5)", () => {
    expect(chargeReply(3_400, null, ctx([SAFEWAY, NSF])).body).toBe(
      "That's an insufficient funds fee on Chase checking, Nov 2, for a $16.40 item. Banks often refund a first one if you ask.",
    );
  });

  it("finds it on the day asked, and not on another", () => {
    const overdraft = line(
      "2026-10-28",
      3_500,
      "OVERDRAFT FEE FOR A $6.20 ITEM",
      "BANK_FEES_OVERDRAFT_FEES",
    );
    expect(chargeReply(3_500, "2026-10-28", ctx([overdraft])).body).toMatch(
      /^That's an overdraft fee on Chase checking, Oct 28, for a \$6\.20 item\./,
    );
    expect(chargeReply(3_500, "2026-09-28", ctx([overdraft])).body).toBe(
      "I don't see a $35.00 charge on Sep 28. If it's still pending, or on an account Jane can't see, it isn't here yet.",
    );
  });

  it("gives a monthly fee with the waiver card's reason when Jane raised one (upload S2)", () => {
    const why =
      "Your Bank of America checking charged a $12.00 monthly fee on October 28, 2026, and $2,900.00 in pay was deposited there in the month before.";
    const reply = chargeReply(
      1_200,
      null,
      ctx(MONTHLY, { why, href: "https://www.bankofamerica.com/" }),
    );
    expect(reply.body).toBe(
      `That's a monthly maintenance fee on Chase checking, Oct 28. It's been charged 3 times since Aug 28. ${why}`,
    );
    expect(reply.actions[0]).toMatchObject({ href: "https://www.bankofamerica.com/" });
  });

  it("names a shop's charge by its cleaned name, never the bank's line", () => {
    const body = chargeReply(1_640, null, ctx([SAFEWAY])).body;
    expect(body).toMatch(/^That's Safeway Berkeley, \$16\.40 on Nov 2, from Chase checking\.$/);
    expect(body).not.toContain("#1234");
  });
});

describe("the fees paid", () => {
  const year = [
    line("2026-02-02", 3_500, "OVERDRAFT FEE", "BANK_FEES_OVERDRAFT_FEES"),
    line("2026-07-31", 3_500, "OVERDRAFT FEE", "BANK_FEES_OVERDRAFT_FEES"),
    ...["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01"].map((d) =>
      line(d, 1_000, "MONTHLY SERVICE FEE", "BANK_FEES_OTHER_BANK_FEES"),
    ),
    line("2026-08-30", 2_900, "LATE FEE", "BANK_FEES_LATE_FEES", "card"),
  ];

  it("adds up the last 12 months by kind, as the pages count them (desktop sweep 7, upload S6)", () => {
    expect(feesPaidReply(false, 12, ctx(year)).body).toBe(
      "You paid $139.00 in 7 fees in the last 12 months: 2 overdraft fees ($70.00), 4 monthly maintenance fees ($40.00), one late fee ($29.00, Aug 30).",
    );
  });

  it("gives late fees alone when asked", () => {
    expect(feesPaidReply(true, 12, ctx(year)).body).toBe(
      "You paid $29.00 in one fee in the last 12 months: one late fee ($29.00, Aug 30).",
    );
  });

  it("leaves out a fee the bank gave back", () => {
    const back = line("2026-08-01", -3_500, "OVERDRAFT FEE REVERSAL", "BANK_FEES_OVERDRAFT_FEES");
    expect(feesPaidReply(false, 12, ctx([...year, back])).body).toMatch(
      /^You paid \$104\.00 in 6 fees/,
    );
  });

  it("says plainly when there are none", () => {
    expect(feesPaidReply(true, 3, ctx([SAFEWAY])).body).toBe(
      "I don't see a late fee in 3 months of data.",
    );
  });
});

describe("a fee waived", () => {
  it("is the waiver card's reason when Jane raised one", () => {
    expect(
      waiverReply(ctx(MONTHLY, { why: "Bank of America waives it.", href: "https://x.test/" }))
        .body,
    ).toBe("Bank of America waives it.");
  });

  it("otherwise says what the monthly fee is and who decides", () => {
    expect(waiverReply(ctx(MONTHLY)).body).toBe(
      "Chase checking charged a $12.00 monthly fee on Oct 28. Banks usually waive it with a set direct deposit or balance, but I don't know your account's rules, so ask your bank which applies to yours.",
    );
  });

  it("with no monthly fee, says so", () => {
    expect(waiverReply(ctx([NSF])).body).toMatch(/^I don't see a monthly bank fee to waive\./);
  });
});

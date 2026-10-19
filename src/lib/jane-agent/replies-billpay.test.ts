import { describe, expect, it } from "vitest";
import type { BillPayItem } from "@/lib/money-movement/bill-pay";
import { billPayReply, billsReply } from "./replies-billpay";
import { STAND_IN_NOTE } from "./replies-paycheck";

// Spec step 145: how Jane says a bill is paid, waits for a tap or can't be paid in time.

const bill = {
  accountId: "card",
  name: "Demo Credit Card",
  kind: "credit",
  dueOn: "2026-10-26",
  minimumCents: 3_500,
  balanceCents: 241_050,
  autopay: null,
};
const key = "bill:card:2026-10-26";

describe("billPayReply", () => {
  it("says nothing for a bill the person's own autopay covers", () => {
    expect(billPayReply({ status: "autopay", bill, planKey: key }, "2026-10-16", null)).toBeNull();
  });

  it("asks with one tap, saying what checking keeps", () => {
    const item: BillPayItem = {
      status: "ask",
      bill,
      planKey: key,
      amountCents: 3_500,
      runOn: "2026-10-24",
      full: false,
    };
    const reply = billPayReply(item, "2026-10-16", "2026-10-28")!;
    expect(reply.body).toBe(
      `Your Demo Credit Card payment is due Oct 26 (in 10 days). Nothing is set to pay it yet. Checking can cover the $35.00 minimum on Oct 24 and still keep $100.00 every day of the forecast. Want me to schedule it? ${STAND_IN_NOTE}`,
    );
    expect(reply.actions.map((a) => a.id)).toEqual(["bill.pay", "bill.skip", "open"]);
    expect(reply.refs).toEqual({ billKey: key });
  });

  it("says what autopilot scheduled, with Undo on Transfers", () => {
    const item: BillPayItem = {
      status: "scheduled",
      bill,
      planKey: key,
      amountCents: 3_500,
      runOn: "2026-10-24",
      by: "autopilot",
    };
    expect(billPayReply(item, "2026-10-16", null)!.body).toMatch(
      /I scheduled \$35\.00 from checking for Oct 24, by myself \(autopilot\), so it lands on time\. You can undo it on Transfers/,
    );
  });

  it("suggests moving a due date that lands before payday, and schedules nothing", () => {
    const item: BillPayItem = { status: "short", bill, planKey: key, moveTo: "2026-10-29" };
    const reply = billPayReply(item, "2026-10-16", "2026-10-28")!;
    expect(reply.body).toMatch(
      /I haven't scheduled it\. It lands before payday \(Oct 28\): ask the lender to move your due date to Oct 29 or later\./,
    );
    expect(reply.actions).toEqual([]);
  });
});

describe("billsReply", () => {
  it("needs a money-movement partner", () => {
    expect(billsReply(null, "2026-10-16").body).toMatch(/needs a money-movement partner/);
  });

  it("lists what pays each bill", () => {
    const reply = billsReply(
      {
        checkingAccountId: "checking",
        payday: "2026-10-28",
        items: [
          {
            status: "autopay",
            bill: { ...bill, name: "Home Loan", dueOn: "2026-11-01" },
            planKey: "a",
          },
          {
            status: "ask",
            bill,
            planKey: key,
            amountCents: 3_500,
            runOn: "2026-10-24",
            full: false,
          },
        ],
      },
      "2026-10-16",
    );
    expect(reply.body).toBe(
      "Here's what's due in the next three weeks. Home Loan, due Nov 1: your own autopay covers it. Demo Credit Card, due Oct 26: not set to be paid yet; I can pay $35.00 on Oct 24.",
    );
    expect(reply.actions[0].id).toBe("bill.pay");
  });
});

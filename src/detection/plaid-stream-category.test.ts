import { describe, expect, it } from "vitest";
import { billsAhead } from "@/lib/coming-up";
import { CHECKING, tx } from "./__fixtures__/build";
import type { DetectionInput, DetectionRecurringStream } from "./types";
import { addDays } from "./units";

// Debug 2, desktop sweep 8 (11-19, Plaid sandbox: checking paying rent by Zelle, T-Mobile,
// Progressive, Nelnet and Toyota each month): Plaid's recurring streams all said
// TRANSFER_OUT_ACCOUNT_TRANSFER while their charges said phone, insurance, rent and loan payments.
// Bills read "Nothing expected in the next month yet", and the same page's low point took them off
// as transfers. A stream that calls itself a transfer takes the category its own charges agree on.

const MONTHS = ["2026-08-14", "2026-09-14", "2026-10-14", "2026-11-14"];
const TMOBILE = MONTHS.map((date, i) =>
  tx({
    date,
    amountCents: 7_000,
    description: "T-Mobile",
    pfcPrimary: "RENT_AND_UTILITIES",
    pfcDetailed: "RENT_AND_UTILITIES_TELEPHONE",
    plaidTransactionId: `t${i}`,
  }),
);
const stream = (pfcPrimary: string, pfcDetailed: string): DetectionRecurringStream => ({
  id: "tmobile",
  accountId: CHECKING.id,
  plaidStreamId: "tmobile",
  merchantName: "T-Mobile",
  frequency: "MONTHLY",
  lastAmountCents: 7_000,
  averageAmountCents: 7_000,
  lastDate: "2026-11-14",
  predictedNextDate: addDays("2026-11-14", 30),
  status: "MATURE",
  isActive: true,
  pfcPrimary,
  pfcDetailed,
  transactionIds: TMOBILE.map((t) => t.plaidTransactionId!),
});
const bills = (s: DetectionRecurringStream) =>
  billsAhead(
    {
      asOf: "2026-11-19",
      accounts: [CHECKING],
      transactions: TMOBILE,
      recurringStreams: [s],
    } as unknown as DetectionInput,
    30,
  ).map((b) => `${b.merchant} ${b.date}`);

describe("a Plaid stream that calls itself a transfer", () => {
  it("is the bill its charges say it is", () => {
    expect(bills(stream("TRANSFER_OUT", "TRANSFER_OUT_ACCOUNT_TRANSFER"))).toEqual(
      bills(stream("RENT_AND_UTILITIES", "RENT_AND_UTILITIES_TELEPHONE")),
    );
    expect(bills(stream("TRANSFER_OUT", "TRANSFER_OUT_ACCOUNT_TRANSFER"))).toEqual([
      "T-Mobile 2026-12-14",
    ]);
  });
});

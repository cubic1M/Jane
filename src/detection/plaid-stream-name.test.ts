import { describe, expect, it } from "vitest";
import { billsAhead } from "@/lib/coming-up";
import { CHECKING, tx } from "./__fixtures__/build";
import type { DetectionInput, DetectionRecurringStream } from "./types";

// Debug 2, desktop sweep 8 (11-19, Plaid sandbox + loans): Bills listed "NELNET STUDENT LN
// PAYMENT", "TOYOTA FINANCIAL PMT" and "PROGRESSIVE INS PREM", Plaid's stream names in the bank's
// capitals, for charges Plaid itself names Nelnet, Toyota Financial and Progressive Insurance.

const MONTHS = ["2026-08-18", "2026-09-18", "2026-10-18"];
const rows = (merchantName: string | null) =>
  MONTHS.map((date, i) =>
    tx({
      date,
      amountCents: 15_499,
      description: "PROGRESSIVE INS PREM",
      merchantName,
      pfcPrimary: "GENERAL_SERVICES",
      pfcDetailed: "GENERAL_SERVICES_INSURANCE",
      plaidTransactionId: `p${i}`,
    }),
  );
const stream = (merchantName: string): DetectionRecurringStream => ({
  id: "progressive",
  accountId: CHECKING.id,
  plaidStreamId: "progressive",
  merchantName,
  frequency: "MONTHLY",
  lastAmountCents: 15_499,
  averageAmountCents: 15_499,
  lastDate: "2026-10-18",
  predictedNextDate: "2026-11-18",
  status: "MATURE",
  isActive: true,
  pfcPrimary: "GENERAL_SERVICES",
  pfcDetailed: "GENERAL_SERVICES_INSURANCE",
  transactionIds: ["p0", "p1", "p2"],
});
const named = (streamName: string, chargeName: string | null) =>
  billsAhead(
    {
      asOf: "2026-11-19",
      accounts: [CHECKING],
      transactions: rows(chargeName),
      recurringStreams: [stream(streamName)],
    } as unknown as DetectionInput,
    30,
  ).map((b) => b.merchant);

describe("a Plaid stream named in the bank's capitals", () => {
  it("takes the name Plaid gives its charges", () => {
    expect(named("PROGRESSIVE INS PREM", "Progressive Insurance")).toEqual([
      "Progressive Insurance",
    ]);
  });

  it("keeps a name Plaid wrote in capitals for both", () => {
    expect(named("GEICO", "GEICO")).toEqual(["GEICO"]);
  });
});

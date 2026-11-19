import { describe, expect, it } from "vitest";
import { billsAhead } from "@/lib/coming-up";
import { CHECKING, tx } from "./__fixtures__/build";
import type { DetectionInput, DetectionRecurringStream } from "./types";
import { addDays } from "./units";

// Due-soon bills dropped by a calendar effect (debug 2, sweep 6, 11-18): with a linked bank's data
// ending Nov 13, Bills listed Verizon's $65 on the 16th and a $200 card payment due Nov 17 and
// Dec 17 on Nov 17, and on Nov 18 neither: Plaid had marked both streams inactive once their
// expected dates passed, and Jane took that as the bill having stopped. Read each day after, as
// Plaid would sync it that day, a monthly bill stays, at its next date, until it's past
// ACTIVE_WITHIN_INTERVALS of its usual gap; a stream Plaid tombstoned never comes back.

// Oct 16, 2025 to Oct 16, 2026, monthly.
const MONTHS = Array.from({ length: 13 }, (_, i) =>
  new Date(Date.UTC(2025, 9 + i, 16)).toISOString().slice(0, 10),
);
const charges = (prefix: string, day: number, cents: number, description: string, pfc: string) =>
  MONTHS.map((date, i) =>
    tx({
      date: addDays(date, day),
      amountCents: cents,
      description,
      pfcPrimary: pfc.split("_").slice(0, -1).join("_") || pfc,
      pfcDetailed: pfc,
      plaidTransactionId: `${prefix}${i}`,
    }),
  );
const VERIZON = charges("v", 0, 6_500, "VERIZON WIRELESS", "RENT_AND_UTILITIES_TELEPHONE");
const CARD = charges("c", 1, 20_000, "CARD PAYMENT", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT");
const LINES = [
  ...VERIZON,
  ...CARD,
  tx({ date: "2026-11-13", amountCents: 1_200, plaidTransactionId: "z" }),
];

// Plaid's stream as synced on `asOf`: inactive once its next date has passed with no charge.
const stream = (
  id: string,
  name: string,
  rows: typeof VERIZON,
  asOf: string,
  status = "MATURE",
): DetectionRecurringStream => {
  const last = rows.at(-1)!.date;
  const predicted = addDays(last, 31);
  return {
    id,
    accountId: CHECKING.id,
    plaidStreamId: id,
    merchantName: name,
    frequency: "MONTHLY",
    lastAmountCents: rows.at(-1)!.amountCents,
    averageAmountCents: rows.at(-1)!.amountCents,
    lastDate: last,
    predictedNextDate: predicted,
    status,
    isActive: asOf <= predicted,
    pfcPrimary: rows.at(-1)!.pfcPrimary,
    pfcDetailed: rows.at(-1)!.pfcDetailed,
    transactionIds: rows.map((r) => r.plaidTransactionId!),
  };
};
const input = (asOf: string, status?: string): DetectionInput =>
  ({
    asOf,
    accounts: [CHECKING],
    transactions: LINES,
    recurringStreams: [
      stream("verizon", "Verizon", VERIZON, asOf, status),
      stream("card", "Credit card payment", CARD, asOf, status),
    ],
  }) as unknown as DetectionInput;
const named = (asOf: string, status?: string) =>
  billsAhead(input(asOf, status), 30).map((b) => `${b.merchant} ${b.date}`);

describe("a linked bank's monthly bills, the data held fixed after Nov 13", () => {
  it("lists each at its next date on every day after its expected date passes", () => {
    for (const asOf of ["2026-11-18", "2026-11-19", "2026-11-25", "2026-11-30"]) {
      expect(named(asOf), asOf).toEqual(
        expect.arrayContaining(["Verizon 2026-12-16", "Credit card payment 2026-12-17"]),
      );
    }
  });

  it("drops a bill past one and a half of its usual gaps", () => {
    // Oct 16 + 1.5 × ~30.4 days.
    expect(named("2026-12-03").some((b) => b.startsWith("Verizon"))).toBe(false);
  });

  it("never brings back a stream Plaid tombstoned", () => {
    expect(named("2026-11-18", "TOMBSTONED")).toEqual([]);
  });
});

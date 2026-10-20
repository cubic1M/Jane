import { describe, expect, it } from "vitest";
import { AS_OF, CARD, input, plaidStream, sampleYear } from "./__fixtures__/build";
import { renewalAlerts } from "./alerts";
import { detect } from "./detect";
import { upcomingBills } from "./forecast";
import { buildStreams } from "./streams";
import { recurringCharges } from "./subscriptions";
import type { DetectionInput } from "./types";

describe("recurringCharges", () => {
  const data = sampleYear();
  const rows = recurringCharges(data);

  it("agrees with the subscription findings on yearly cost", () => {
    const findings = detect(data).filter((f) => f.type === "subscription_review");
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      const row = rows.find((r) => r.key === f.key);
      expect(row?.annualCostCents, f.key).toBe(f.annualSavingsCents);
      expect(row?.subscription).toBe(true);
    }
  });

  it("agrees with the bills forecast on the next date", () => {
    const bills = upcomingBills(data, 40);
    for (const row of rows) {
      const next = bills.find((b) => b.merchant === row.merchant);
      if (next) expect(row.nextDate, row.merchant).toBe(next.date);
    }
  });

  it("lists the biggest yearly cost first, and marks non-subscriptions", () => {
    expect(rows.map((r) => r.annualCostCents)).toEqual(
      [...rows.map((r) => r.annualCostCents)].sort((a, b) => b - a),
    );
    expect(rows.find((r) => r.merchant === "Geico")?.subscription).toBe(false);
  });
});

describe("renews_soon", () => {
  // Plaid knows Cloudbox as a yearly charge, last taken Oct 20 2025: the next is Oct 20 2026.
  const yearly = (asOf: string): DetectionInput =>
    input({
      asOf,
      recurringStreams: [
        plaidStream({
          accountId: CARD.id,
          plaidStreamId: "cloudbox",
          merchantName: "Cloudbox",
          frequency: "ANNUALLY",
          lastAmountCents: 9_900,
          averageAmountCents: 9_900,
          lastDate: "2025-10-20",
          pfcPrimary: "GENERAL_SERVICES",
          pfcDetailed: "GENERAL_SERVICES_STORAGE",
        }),
      ],
    });
  const run = (data: DetectionInput) => renewalAlerts(data, buildStreams(data));

  it("alerts a week before a yearly renewal, once per renewal date", () => {
    const alerts = run(yearly(AS_OF));
    expect(alerts).toEqual([
      expect.objectContaining({
        type: "renews_soon",
        key: "merchant:cloudbox:2026-10-20",
        title: "Cloudbox renews Oct 20, about $99.00",
      }),
    ]);
    expect(run(yearly(AS_OF)).map((a) => a.key)).toEqual(alerts.map((a) => a.key));
  });

  it("says nothing when the renewal is further off", () => {
    expect(run(yearly("2026-10-01"))).toEqual([]);
  });

  it("never alerts for monthly charges", () => {
    const monthly = input({
      recurringStreams: [plaidStream({ lastDate: "2026-09-18", frequency: "MONTHLY" })],
    });
    expect(run(monthly)).toEqual([]);
  });
});

// Spec step 263 (QA sweep): Jo's "State Dept of Revenue renews" was a tax payment.
describe("renews_soon and taxes", () => {
  const yearlyPayee = (
    merchantName: string,
    pfcPrimary: string,
    pfcDetailed: string,
  ): DetectionInput =>
    input({
      recurringStreams: [
        plaidStream({
          accountId: CARD.id,
          plaidStreamId: merchantName,
          merchantName,
          frequency: "ANNUALLY",
          lastAmountCents: 119_200,
          averageAmountCents: 119_200,
          lastDate: "2025-10-20",
          pfcPrimary,
          pfcDetailed,
        }),
      ],
    });
  const run = (data: DetectionInput) => renewalAlerts(data, buildStreams(data));

  it("never calls a tax or government payment a renewal, by category or by name", () => {
    expect(
      run(
        yearlyPayee(
          "State Dept of Revenue",
          "GOVERNMENT_AND_NON_PROFIT",
          "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
        ),
      ),
    ).toEqual([]);
    expect(
      run(
        yearlyPayee(
          "State Dept of Revenue",
          "GENERAL_SERVICES",
          "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
        ),
      ),
    ).toEqual([]);
    expect(
      run(
        yearlyPayee(
          "IRS USATAXPYMT",
          "GENERAL_SERVICES",
          "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
        ),
      ),
    ).toEqual([]);
  });

  it("still alerts for a real yearly subscription", () => {
    expect(
      run(yearlyPayee("Cloudbox", "GENERAL_SERVICES", "GENERAL_SERVICES_STORAGE")),
    ).toHaveLength(1);
  });
});

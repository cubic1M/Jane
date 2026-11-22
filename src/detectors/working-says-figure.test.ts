import { describe, expect, it } from "vitest";
import { formatCents } from "@/lib/money";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";
import { LIFE_DETECTORS } from "./life";
import { SPENDING_DETECTORS } from "./spending";
import { TAX_DETECTORS } from "./taxes";
import { UTILITY_DETECTORS } from "./utilities";

// The manager on class 11 (11-22): a card that opens Coming up or a Taxes item shows its figure and
// how it was worked out there, as its working (its why) says it. Each of these said its figure
// nowhere in the why.

const fire = (data: ProfileInput, detectors: Parameters<typeof runDetectors>[1], topic: string) =>
  runDetectors({ profile: buildProfile(data), data }, detectors).find((s) => s.topic === topic) ??
  null;

describe("a card's working says its figure", () => {
  it("low-cost internet: what the plan takes off, a month and a year", () => {
    const base = inputFor("renter");
    const account = base.accounts[0]!.id;
    const internet = "RENT_AND_UTILITIES_INTERNET_AND_CABLE";
    const data: ProfileInput = {
      ...base,
      householdSize: 1,
      told: { ...base.told, monthly_income: 200_000 },
      transactions: [
        ...base.transactions.filter((t) => t.pfc !== internet),
        ...["2026-08-05", "2026-09-05", "2026-10-05"].map((date) => ({
          date,
          amountCents: 7_000,
          description: "COMCAST XFINITY",
          pfc: internet,
          accountId: account,
        })),
      ],
    };
    const s = fire(data, UTILITY_DETECTORS, "low_cost_internet")!;
    // By hand: $70.00 a month against Internet Essentials' $14.95, $55.05 a month, $660.60 a year.
    expect(s.worthCents).toBe(66_060);
    expect(s.why).toContain("about $55.05 a month less, $660.60 a year");
  });

  it("the bill rate from what people who ask get off, with no report figure", () => {
    const s = fire(inputFor("renter"), SPENDING_DETECTORS, "bill_negotiation")!;
    // By hand: 12% off what the renter pays for phone and internet in a year.
    expect(s.why).toContain(`% off, about ${formatCents(s.worthCents)} a year.`);
  });

  it("childcare: what the FSA saves beyond the credit", () => {
    const s = fire(inputFor("family"), TAX_DETECTORS, "childcare_tax_break")!;
    expect(s.why).toContain(`${formatCents(s.worthCents)} more than the credit's`);
  });

  it("pay that stopped: how much less comes in than before", () => {
    const sample = inputFor("renter");
    const accountId = sample.accounts.find((a) => a.type === "depository")!.id;
    const every = (days: number, from: string, to: string) => {
      const out: string[] = [];
      for (
        let d = Date.parse(`${from}T00:00:00Z`);
        d <= Date.parse(`${to}T00:00:00Z`);
        d += days * 86_400_000
      )
        out.push(new Date(d).toISOString().slice(0, 10));
      return out;
    };
    const rows = [
      ...every(14, "2026-02-06", "2026-08-07").map((date) => ({
        date,
        amountCents: -264_018,
        pfc: "INCOME_SALARY",
        description: "ACME LOGISTICS INC PAYROLL",
      })),
      ...every(7, "2026-09-08", "2026-10-27").map((date) => ({
        date,
        amountCents: -45_000,
        pfc: "INCOME_UNEMPLOYMENT",
        description: "CA EDD UI DIRECT DEP",
      })),
      ...every(7, "2026-02-01", "2026-10-30").map((date) => ({
        date,
        amountCents: 5_000,
        pfc: "FOOD_AND_DRINK_GROCERIES",
        description: "SAFEWAY",
      })),
    ];
    const data: ProfileInput = {
      ...sample,
      today: "2026-11-02",
      transactions: rows.map((r, i) => ({ id: `t${i}`, ...r, accountId })),
    };
    const s = fire(data, LIFE_DETECTORS, "pay_stopped")!;
    expect(s.why).toContain(`about ${formatCents(s.worthCents)} less than the `);
  });
});

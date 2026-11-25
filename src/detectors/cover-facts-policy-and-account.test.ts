import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput, type ProfileTx } from "@/profile/build";
import {
  BILL_FACT_DETECTORS,
  COVER_FACT_DETECTORS,
  isWaivableMonthlyFee,
  waivableFee,
} from "./cover-facts";
import { runDetectors } from "./index";
import { grad, undergrad } from "./__fixtures__/students";

// CodeRabbit sweep 1c, det-01: car cover read from home premiums and same-day payments, and a
// waived monthly fee read across two accounts at one bank.
const DETECTORS = [...COVER_FACT_DETECTORS, ...BILL_FACT_DETECTORS];
const fire = (data: ProfileInput, topic: string) =>
  runDetectors({ profile: buildProfile(data), data }, DETECTORS).find((s) => s.topic === topic) ??
  null;
const row = (
  date: string,
  amountCents: number,
  description: string,
  pfc: string,
  accountId: string,
): ProfileTx => ({ date, amountCents, description, pfc, accountId });

describe("car cover cost", () => {
  const withRows = (rows: ProfileTx[]): ProfileInput => ({
    ...grad(),
    transactions: [...grad().transactions, ...rows],
  });
  const insurance = (dates: string[], cents: number, name: string) =>
    dates.map((d) => row(d, cents, name, "GENERAL_SERVICES_INSURANCE", "grad-checking"));

  it("does not call two homeowners premiums from a car insurer car cover", () => {
    // $1,000 every six months at State Farm: only the word HOMEOWNERS says it is not the car.
    const home = withRows(
      insurance(["2026-05-05", "2026-11-05"], 100_000, "STATE FARM HOMEOWNERS"),
    );
    expect(fire(home, "car_cover_cost")).toBeNull();
    // The same payments on a car policy are $2,000 a year, above the average.
    const car = withRows(insurance(["2026-05-05", "2026-11-05"], 100_000, "STATE FARM AUTO"));
    expect(fire(car, "car_cover_cost")).not.toBeNull();
  });

  it("does not read two payments on the same day as a monthly premium", () => {
    // Two $1,000 six-month premiums on one day: no rhythm to scale, so no $24,000 a year.
    const same = withRows(insurance(["2026-11-05", "2026-11-05"], 100_000, "GEICO *AUTO"));
    expect(fire(same, "car_cover_cost")).toBeNull();
  });

  it("reads each policy at its own rhythm", () => {
    // One policy monthly ($100, $1,200 a year), one every six months ($600, $1,200 a year): $2,400.
    const two = withRows([
      ...insurance(["2026-09-05", "2026-10-05", "2026-11-05"], 10_000, "GEICO *AUTO"),
      ...insurance(["2026-05-12", "2026-11-12"], 60_000, "PROGRESSIVE AUTO INS"),
    ]);
    const s = fire(two, "car_cover_cost")!;
    expect(s).not.toBeNull();
    expect(s.short).toContain("$2,400.00");
  });
});

describe("a monthly fee that pay may waive, across two accounts", () => {
  const two = (payInto: "fee" | "other"): ProfileInput => {
    const base = undergrad();
    const a = { ...base.accounts[0]!, institution: null, name: "Bank of America checking" };
    const b = { ...a, id: "ug-checking-2", name: "Bank of America checking 2" };
    const feeAccount = a.id;
    return {
      ...base,
      accounts: [a, b],
      transactions: [
        ...base.transactions.filter(
          (t) => t.pfc !== "INCOME_WAGES" && !/SERVICE FEE/.test(t.description),
        ),
        row(
          "2026-11-16",
          1_200,
          "MONTHLY MAINTENANCE FEE",
          "BANK_FEES_OTHER_BANK_FEES",
          feeAccount,
        ),
        row(
          "2026-11-02",
          -145_000,
          "ACME CORP DES:PAYROLL",
          "INCOME_WAGES",
          payInto === "fee" ? feeAccount : b.id,
        ),
      ],
    };
  };

  it("counts pay only in the account that was charged", () => {
    expect(fire(two("other"), "fee_waiver_met")).toBeNull();
    expect(fire(two("fee"), "fee_waiver_met")).not.toBeNull();
  });

  it("speaks only for the account that was charged", () => {
    const data = two("fee");
    const found = waivableFee(data)!;
    expect([...found.accountIds]).toEqual([data.accounts[0]!.id]);
    const otherFee = row(
      "2026-11-16",
      1_200,
      "MONTHLY MAINTENANCE FEE",
      "BANK_FEES_OTHER_BANK_FEES",
      "ug-checking-2",
    );
    expect(isWaivableMonthlyFee(found.fee, found)).toBe(true);
    expect(isWaivableMonthlyFee(otherFee, found)).toBe(false);
  });
});

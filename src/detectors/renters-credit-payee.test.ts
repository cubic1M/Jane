import { describe, expect, it } from "vitest";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { STUDENT_CREDIT_DETECTORS } from "./student-credits";
import { runDetectors } from "./index";

// Debug 2, desktop sweep 7, upload S3 (11-19, Chase checking paying rent by Zelle): Taxes said "You
// paid rent to Zelle Payment To Jordan P in 4 months" while Bills listed the same rent as "Jordan
// P", Jane's cleaned name for it. A card names a payee as the rest of Jane does.

const tx = (
  date: string,
  amountCents: number,
  description: string,
  pfc: string,
  merchantName: string | null = null,
) => ({
  date,
  amountCents,
  description,
  merchantName,
  pfc,
  accountId: "chk",
});
const months = ["2026-08", "2026-09", "2026-10", "2026-11"];
const data: ProfileInput = {
  today: "2026-11-19",
  accounts: [{ id: "chk", type: "depository", subtype: "checking", balanceCents: 24_390 }],
  liabilities: [],
  told: { home_state: "CA" },
  transactions: [
    ...months.map((m) =>
      tx(
        `${m}-01`,
        112_500,
        "ZELLE PAYMENT TO JORDAN P RENT",
        "RENT_AND_UTILITIES_RENT",
        "Jordan P",
      ),
    ),
    ...months.flatMap((m) => [
      tx(`${m}-07`, -94_000, "TARGET CORP PAYROLL PPD", "INCOME_SALARY"),
      tx(`${m}-21`, -94_000, "TARGET CORP PAYROLL PPD", "INCOME_SALARY"),
    ]),
  ],
};

describe("California's renter's credit", () => {
  it("names the landlord as Bills does", () => {
    const card = runDetectors({ profile: buildProfile(data), data }, STUDENT_CREDIT_DETECTORS).find(
      (s) => s.topic === "ca_renters_credit",
    );
    expect(card?.why).toContain("You paid rent to Jordan P in");
  });
});

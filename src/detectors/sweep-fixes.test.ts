import { describe, expect, it } from "vitest";
import { categorizeByRules } from "@/categorize/rules";
import { ADDON_RULES } from "@/config/car-loan";
import { RENT_CATEGORY } from "@/config/renting";
import { payeeOf } from "@/planning/price-rises";
import { isRent } from "@/planning/renting";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";

// What the detector sweep over uploaded statements found (Stage 1, docs/detector-sweep.md): each
// of these never fired on a statement that plainly had what it's for.

const tx = (date: string, amountCents: number, description: string, pfc: string | null = null) => ({
  id: `${date}-${description}`,
  accountId: "x",
  date,
  amountCents,
  description,
  pfc,
  merchantName: null,
});
const firing = (data: ProfileInput) =>
  runDetectors({ profile: buildProfile(data), data }).map((s) => s.topic);
const withLines = (lines: ReturnType<typeof tx>[]): ProfileInput => {
  const d = inputFor("renter");
  return { ...d, transactions: [...d.transactions, ...lines] };
};
const months = (n: number, day = 5) =>
  Array.from({ length: n }, (_, i) => {
    const month = new Date(Date.UTC(2026, 9 - i, day));
    return month.toISOString().slice(0, 10);
  });

describe("the rules a statement goes through", () => {
  const rule = (description: string, cents: number) =>
    categorizeByRules({ description, amountCents: cents, hints: {} })?.detailed;

  it("read payday and pay-app repayments as what they are", () => {
    expect(rule("CHECK INTO CASH PAYMENT", 46_000)).toBe("LOAN_PAYMENTS_CASH_ADVANCES");
    expect(rule("ADVANCE AMERICA PAYMENT", 46_000)).toBe("LOAN_PAYMENTS_CASH_ADVANCES");
    expect(rule("EARNIN ACTIVEHOURS", 10_000)).toBe("LOAN_PAYMENTS_EWA");
    // Money in stays a disbursement.
    expect(rule("ADVANCE AMERICA LOAN", -40_000)).toBe("LOAN_DISBURSEMENTS_CASH_ADVANCES");
  });

  it("read gig pay as gig pay, even written like a direct deposit", () => {
    expect(rule("UBER USA 6787 EDI PAYMNT DIR DEP PPD ID: 1", -50_000)).toBe("INCOME_GIG_ECONOMY");
    expect(rule("DOORDASH, INC. PAYOUT DIR DEP PPD ID: 2", -50_000)).toBe("INCOME_GIG_ECONOMY");
    // An employee of Uber is on salary.
    expect(rule("UBER TECHNOLOGIES DIRECT DEP", -300_000)).toBe("INCOME_SALARY");
  });

  it("read the wider student loan wordings", () => {
    for (const line of ["US DEPT OF EDUCATION", "FEDLOAN SERVICING", "STUDENT LOAN PMT"]) {
      expect(rule(line, 40_000), line).toBe("LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT");
    }
    expect(rule("STUDENT LOAN DISB", -100_000)).not.toBe("LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT");
  });
});

describe("the detectors", () => {
  it("rent is whatever is filed as rent, not only names with the word in them", () => {
    for (const description of [
      "CEDAR RIDGE APTS WEB PMT",
      "GREYSTAR RE PAYMENT",
      "Zelle to J SMITH",
    ]) {
      expect(
        isRent({ date: "2026-10-01", amountCents: 180_000, description, pfc: RENT_CATEGORY }),
        description,
      ).toBe(true);
    }
    expect(
      isRent({ date: "2026-10-01", amountCents: 1, description: "HOME RENT", pfc: RENT_CATEGORY }),
    ).toBe(false);
  });

  it("a payee is one payee across ACH lines whose IDs change", () => {
    const a = "COMCAST XFINITY DES:CABLE ID:XXXXX12345 INDN:DOE, JANE CO ID:XXXXX12345 PPD";
    const b = "COMCAST XFINITY DES:CABLE ID:XXXXX99999 INDN:DOE, JANE CO ID:XXXXX12345 PPD";
    expect(payeeOf(a)).toBe(payeeOf(b));
    expect(payeeOf(a)).toBe("Comcast Xfinity");
  });

  it("a premium rising across ACH lines with changing IDs is one premium", () => {
    const lines = months(12).map((date, i) =>
      tx(
        date,
        i === 0 ? 16_000 : 13_000,
        `STATE FARM RO 27 DES:SFPP ID:XXXXX${10000 + i} INDN:DOE, JANE CO ID:XXXXX12345 PPD`,
        "GENERAL_SERVICES_INSURANCE",
      ),
    );
    expect(firing(withLines(lines))).toContain("insurance_negotiation");
  });

  it("an annual membership fee counts as a premium card's", () => {
    const lines = [
      ...months(12).map((date) => tx(date, 1_700, "ASURION WIRELESS INS")),
      tx("2026-08-01", 55_000, "ANNUAL MEMBERSHIP FEE"),
    ];
    expect(firing(withLines(lines))).toContain("card_cover");
  });

  it("HSA deposits on a statement are enough, with no HSA linked", () => {
    const lines = months(10).map((date) => tx(date, 90_000, "HEALTHEQUITY HSA CONTRIB"));
    expect(firing(withLines(lines))).toContain("hsa_over_limit");
  });

  it("a word with HSA inside it isn't an HSA deposit", () => {
    const lines = months(10).map((date) => tx(date, 90_000, "MARSHALLS 0412"));
    expect(firing(withLines(lines))).not.toContain("hsa_over_limit");
  });

  it("steady pay with no pay word is pay, not a shop's sales", () => {
    const d = inputFor("renter");
    const clean = d.transactions.filter((t) => !t.pfc?.startsWith("INCOME_"));
    const steady = Array.from({ length: 26 }, (_, i) =>
      tx(
        `2026-${String((i % 9) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`,
        -170_000,
        "NORTHWIND LABS",
        "INCOME_OTHER",
      ),
    );
    const shop = steady.map((t, i) => ({
      ...t,
      description: `CUSTOMER ${i}`,
      amountCents: -(5_000 + i * 900),
    }));
    const pattern = (lines: typeof steady) =>
      buildProfile({ ...d, transactions: [...clean, ...lines] }).facts.income_pattern.value;
    expect(pattern(steady)).toBe("salary");
    expect(pattern(shop)).toBe("business");
  });

  it("GAP cover needs more than the word: that's also the clothes shop", () => {
    const gap = ADDON_RULES.gap.match;
    expect(gap.test("GAP #1234 SAN FRANCISCO CA")).toBe(false);
    expect(gap.test("DEALER GAP INSURANCE")).toBe(true);
    expect(gap.test("Guaranteed Asset Protection")).toBe(true);
  });
});

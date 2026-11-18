import { describe, expect, it, vi } from "vitest";
import { tellsThemToAct } from "@/lib/real-account-text";
import { HEADLINE_VERBS } from "@/config/detectors";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import {
  BILL_GAP,
  CARD_VS_CASH,
  FEDERAL_LOANS,
  STANFORD_PAYMENT_PLAN,
} from "@/config/student-money";
import { checkGuardrails, dollarFigures, recommendsAChoice } from "@/lib/guardrails";
import { buildProfile, type ProfileInput, type ProfileTx } from "@/profile/build";
import { missingFacts } from "@/profile/questions";
import { PEOPLE } from "@/config/people";
import { inputFor } from "@/profile/sample";
import { HEADLINE_MAX, SHORT_MAX, type Suggestion } from "./contract";
import { DETECTORS, runDetectors } from "./index";
import { STUDENT_MONEY_DETECTORS, atStanford, cashClearsCard } from "./student-money";
import { grad, undergrad } from "./__fixtures__/students";

// Suggest-money lane (11-18): a bill ahead the cash won't cover, Stanford's bill and its payment
// plan, and card interest paid while cash sits.

const fire = (data: ProfileInput, topic: string, detectors = STUDENT_MONEY_DETECTORS) =>
  runDetectors({ profile: buildProfile(data), data }, detectors).find((s) => s.topic === topic) ??
  null;

// Every sentence passes the guardrails a real account's text does, and recommends no pick.
function expectClean(s: Suggestion) {
  for (const text of [s.title, s.headline, s.short, s.why]) {
    const allowed = dollarFigures(text).map((f) => f.cents);
    expect(checkGuardrails(text, allowed), text).toEqual({ ok: true });
    expect(recommendsAChoice(text), text).toBe(false);
    // Real-account text never tells them what to do with money (src/lib/real-account-text.ts).
    expect(tellsThemToAct(text), text).toBe(false);
  }
  expect(s.headline.length).toBeLessThanOrEqual(HEADLINE_MAX);
  expect(HEADLINE_VERBS, s.headline).toContain(s.headline.split(" ")[0]);
  expect(s.short.length).toBeLessThanOrEqual(SHORT_MAX);
}

const row = (
  date: string,
  amountCents: number,
  description: string,
  pfc: string,
  accountId = "ug-checking",
): ProfileTx => ({ date, amountCents, description, pfc, accountId });

// The undergraduate, told they're a student, paying Stanford's autumn bill themselves.
const payingBill = (cash: number, bill = 420_000, today = "2026-11-24"): ProfileInput => {
  const base = undergrad();
  return {
    ...base,
    today,
    told: { is_student: true },
    accounts: [{ ...base.accounts[0]!, balanceCents: cash }],
    transactions: [
      ...base.transactions,
      row("2026-10-19", bill, "STANFORD UNIV STUDENT ACCT EPAY", "GENERAL_SERVICES_EDUCATION"),
      row("2026-11-20", 2_000, "STANFORD CAMPUS DINING", "FOOD_AND_DRINK_RESTAURANT"),
    ],
  };
};

describe("Stanford", () => {
  it("is read from lines naming the university, never its hospital or credit union", () => {
    expect(atStanford(undergrad())).toBe(true);
    const hospital: ProfileInput = {
      ...undergrad(),
      transactions: [
        row("2026-10-01", 9_000, "STANFORD HEALTH CARE", "MEDICAL_PRIMARY_CARE"),
        row("2026-10-02", 1_000, "STANFORD FEDERAL CREDIT UNION FEE", "BANK_FEES_OTHER_BANK_FEES"),
        row("2026-10-03", 1_000, "SFCU STANFORD TRANSFER", "TRANSFER_OUT_ACCOUNT_TRANSFER"),
      ],
    };
    expect(atStanford(hospital)).toBe(false);
  });
});

describe("a bill ahead the cash won't cover", () => {
  it("says the gap in the person's own figures, with Stanford's and the federal options", () => {
    // $420 left; the winter bill on Dec 17 repeats the $4,200 paid in October.
    const s = fire(payingBill(42_000), "bill_gap_ahead")!;
    expect(s).not.toBeNull();
    expect(s.title).toContain("December 17");
    expect(s.why).toContain("$4,200.00");
    expect(s.why).toContain("$420.00 in cash");
    expect(s.why).toContain("payment plan is free");
    expect(s.why).toContain(`6.52%`);
    expect(s.why).toContain("Private student loans also exist");
    // Cheapest first: the free plan before the federal loans, the loans before private ones.
    expect(s.why.indexOf("payment plan")).toBeLessThan(s.why.indexOf("Federal Direct Loans"));
    expect(s.why.indexOf("Federal Direct Loans")).toBeLessThan(s.why.indexOf("Private"));
    expect(s.more?.map((m) => m.href)).toContain(FEDERAL_LOANS.ratesUrl);
    expect(s.more?.map((m) => m.href)).toContain(STANFORD_PAYMENT_PLAN.url);
    expect(s.worthKind).toBe("risk");
    expect(s.worthCents).toBeGreaterThan(BILL_GAP.minGapCents);
    expectClean(s);
  });

  it("is nothing when the cash covers it", () => {
    expect(fire(payingBill(600_000), "bill_gap_ahead")).toBeNull();
  });

  it("is nothing for someone not known to be a student", () => {
    const data = { ...payingBill(42_000), told: {} };
    const plain = {
      ...data,
      transactions: data.transactions.filter((t) => !/BOOKSTORE|CAMPUS/.test(t.description)),
    };
    expect(buildProfile(plain).facts.is_student.value).not.toBe(true);
    expect(fire(plain, "bill_gap_ahead")).toBeNull();
  });

  it("is nothing when the data ends weeks before today: an old balance says nothing about now", () => {
    expect(fire(payingBill(42_000, 420_000, "2026-12-01"), "bill_gap_ahead")).not.toBeNull();
    // An uploaded statement read on Nov 21, a month later.
    const old = payingBill(42_000, 420_000, "2026-12-20");
    const uploaded = {
      ...old,
      transactions: old.transactions.map((t) => ({ ...t, uploadedOn: "2026-11-21" })),
    };
    expect(fire(uploaded, "bill_gap_ahead")).toBeNull();
  });

  it("looks at rent for a student with no bill payment: the gap at the next rent day", () => {
    const base = grad();
    const data: ProfileInput = {
      ...base,
      told: { is_student: true },
      accounts: base.accounts.map((a) =>
        a.type === "depository" ? { ...a, balanceCents: a.subtype === "savings" ? 0 : 50_000 } : a,
      ),
    };
    const s = fire(data, "bill_gap_ahead")!;
    expect(s).not.toBeNull();
    expect(s.title).toContain("rent on December 1");
    expect(s.why).toContain("$2,100.00");
    // Stanford's grad pay is in the data, so the Stanford options are said too.
    expect(s.why).toContain("cash advance");
    expectClean(s);
    // With the savings back, it's covered.
    expect(fire({ ...base, told: { is_student: true } }, "bill_gap_ahead")).toBeNull();
  });

  it("is nothing on too little history to read a pace (under three weeks)", () => {
    const data = payingBill(42_000);
    const recent = {
      ...data,
      transactions: data.transactions.filter(
        (t) => t.date >= "2026-11-05" || /STUDENT ACCT/.test(t.description),
      ),
    };
    expect(fire(recent, "bill_gap_ahead")).not.toBeNull();
    const tooRecent = {
      ...data,
      transactions: data.transactions.filter((t) => t.date >= "2026-11-05"),
    };
    expect(fire(tooRecent, "bill_gap_ahead")).toBeNull();
  });

  it("names no Stanford program for a student elsewhere", () => {
    const elsewhere: ProfileInput = {
      ...grad(),
      told: { is_student: true },
      transactions: grad().transactions.map((t) => ({
        ...t,
        description: t.description.replace("STANFORD UNIVERSITY", "STATE UNIV"),
      })),
      accounts: grad().accounts.map((a) =>
        a.type === "depository" ? { ...a, balanceCents: a.subtype === "savings" ? 0 : 50_000 } : a,
      ),
    };
    const s = fire(elsewhere, "bill_gap_ahead")!;
    expect(s.why).not.toMatch(/Stanford/);
    expect(s.why).toContain("Federal Direct Loans");
  });
});

describe("Stanford's bill and its payment plan", () => {
  it("offers the free three-part plan while sign-up is open or near, with the late charge", () => {
    const s = fire(payingBill(600_000, 420_000, "2026-11-20"), "stanford_bill_due")!;
    expect(s).not.toBeNull();
    expect(s.title).toContain("December 16");
    expect(s.short).toContain("$1,400.00");
    // 1% of $4,200 a month past due.
    expect(s.worthCents).toBe(4_200);
    expect(s.why).toContain("1.00% a month");
    expect(s.why).toContain("Axess");
    // Paid by Stanford: they may be a graduate assistant, who has the payroll plan instead.
    expect(s.why).toContain("Payroll Deduction Plan");
    expectClean(s);
  });

  it("is nothing more than two weeks before sign-up opens, or after the last window", () => {
    expect(fire(payingBill(600_000, 420_000, "2026-11-05"), "stanford_bill_due")).toBeNull();
    // Nov 11 is 14 days before Nov 25: just inside.
    expect(fire(payingBill(600_000, 420_000, "2026-11-11"), "stanford_bill_due")).not.toBeNull();
    expect(fire(payingBill(600_000, 420_000, "2027-03-20"), "stanford_bill_due")).toBeNull();
  });

  it("is nothing for someone already paying the bill in monthly parts", () => {
    const inParts = (gapStart: string) => {
      const data = payingBill(600_000, 140_000, "2026-11-20");
      return {
        ...data,
        transactions: [
          ...data.transactions,
          {
            date: gapStart,
            amountCents: 140_000,
            description: "STANFORD UNIV STUDENT ACCT EPAY",
            pfc: "GENERAL_SERVICES_EDUCATION",
            accountId: "ug-checking",
          },
        ],
      };
    };
    // Oct 19 and Nov 18 are 30 days apart: in parts. Oct 19 and Sep 8 are 41: a quarter apart.
    expect(fire(inParts("2026-11-18"), "stanford_bill_due")).toBeNull();
    expect(fire(inParts("2026-09-08"), "stanford_bill_due")).not.toBeNull();
  });

  it("with no bill payment seen, comes only to someone who says they pay the bill, and asks first", () => {
    const base = { ...undergrad(), today: "2026-11-20", told: { is_student: true } };
    expect(fire(base, "stanford_bill_due")).toBeNull();
    // The question is asked while sign-up is near, of a Stanford student with no bill payment.
    expect(missingFacts(buildProfile(base), base).map((c) => c.spec.fact)).toContain(
      "pays_school_bill",
    );
    const yes = { ...base, told: { ...base.told, pays_school_bill: true } };
    const s = fire(yes, "stanford_bill_due")!;
    expect(s).not.toBeNull();
    expect(s.short).toContain("You pay your Stanford bill");
    expect(s.why).toContain("You told me you pay your Stanford bill");
    expect(s.worthCents).toBe(0);
    expectClean(s);
    expect(
      fire({ ...base, told: { ...base.told, pays_school_bill: false } }, "stanford_bill_due"),
    ).toBeNull();
    // Not asked once sign-up is over two weeks off, or of someone whose bill payments are seen.
    const early = { ...base, today: "2026-11-05" };
    expect(missingFacts(buildProfile(early), early).map((c) => c.spec.fact)).not.toContain(
      "pays_school_bill",
    );
    const paying = payingBill(600_000, 420_000, "2026-11-20");
    expect(missingFacts(buildProfile(paying), paying).map((c) => c.spec.fact)).not.toContain(
      "pays_school_bill",
    );
  });

  it("is nothing without a bill payment of the person's own, or a small one", () => {
    expect(fire({ ...undergrad(), told: { is_student: true } }, "stanford_bill_due")).toBeNull();
    expect(
      fire(payingBill(600_000, BILL_GAP.billMinCents - 1, "2026-11-20"), "stanford_bill_due"),
    ).toBeNull();
    expect(
      fire(payingBill(600_000, BILL_GAP.billMinCents, "2026-11-20"), "stanford_bill_due"),
    ).not.toBeNull();
  });
});

describe("card interest while cash sits", () => {
  it("pays the card off from cash beyond a month of spending, at the card's rate", () => {
    const s = fire(grad(), "card_from_cash")!;
    expect(s).not.toBeNull();
    // $2,350 at 27.99%.
    expect(s.worthCents).toBe(Math.round((235_000 * 2_799) / 10_000));
    expect(s.headline).toMatch(/^Pay off your card from cash/);
    expect(s.why).toContain("27.99%");
    expectClean(s);
    // The general card-interest card steps aside: it's the same interest.
    expect(fire(grad(), "card_interest", DETECTORS)).toBeNull();
  });

  it("pays part when cash covers only part, and nothing under the floor", () => {
    const part = (checking: number) => {
      const base = grad();
      return {
        ...base,
        accounts: base.accounts.map((a) =>
          a.type === "depository"
            ? { ...a, balanceCents: a.subtype === "savings" ? 0 : checking }
            : a,
        ),
      };
    };
    const c = cashClearsCard(part(400_000))!;
    expect(c.clearCents).toBe(400_000 - c.keepCents);
    expect(fire(part(400_000), "card_from_cash")!.headline).toMatch(/^Pay down your card/);
    // Just under the floor of what's worth moving: the plain card-interest card instead.
    const under = c.keepCents + CARD_VS_CASH.minClearCents - 1;
    expect(fire(part(under), "card_from_cash")).toBeNull();
    expect(fire(part(under), "card_interest", DETECTORS)).not.toBeNull();
    expect(fire(part(under + 1), "card_from_cash")).not.toBeNull();
  });

  it("is nothing without interest charges, an unknown card balance or unknown cash", () => {
    const base = grad();
    expect(
      fire(
        {
          ...base,
          transactions: base.transactions.filter((t) => t.pfc !== "BANK_FEES_INTEREST_CHARGE"),
        },
        "card_from_cash",
      ),
    ).toBeNull();
    expect(
      fire(
        {
          ...base,
          accounts: base.accounts.map((a) =>
            a.type === "credit" ? { ...a, balanceKnown: false } : a,
          ),
        },
        "card_from_cash",
      ),
    ).toBeNull();
    expect(
      fire(
        {
          ...base,
          accounts: base.accounts.map((a) =>
            a.type === "depository" ? { ...a, balanceKnown: false } : a,
          ),
        },
        "card_from_cash",
      ),
    ).toBeNull();
  });

  it("uses the interest seen when the bank gives no rate", () => {
    const s = fire({ ...grad(), liabilities: [] }, "card_from_cash")!;
    expect(s.why).not.toContain("%");
    expect(s.worthCents).toBeGreaterThan(0);
  });
});

describe("the thin-data undergraduate and the sample people", () => {
  it("gets none of these wrongly: no card, no bill paid, no rent", () => {
    const data = undergrad();
    const fired = runDetectors({ profile: buildProfile(data), data }, STUDENT_MONEY_DETECTORS);
    expect(fired).toEqual([]);
  });

  it("fires none on the sample people (none is a student paying a bill)", () => {
    for (const p of PEOPLE) {
      const data = inputFor(p.id);
      const fired = runDetectors({ profile: buildProfile(data), data }, STUDENT_MONEY_DETECTORS);
      expect(fired.map((s) => `${p.id}:${s.topic}`)).toEqual([]);
    }
  });
});

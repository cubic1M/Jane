import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { ADVICE_TOPICS } from "@/config/suggestions";
import { tellsThemToAct } from "@/lib/real-account-text";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { STUDENT_AID_DETECTORS } from "./student-aid";
import { runDetectors } from "./index";

// Manager 11-16 (connectors roadmap: the autopay card must be live before Dec 31, 2026): a beta
// student whose only data is an uploaded checking statement paying Nelnet got no autopay card.
// The card read only the loan accounts a linked bank reports, which an upload never has. From the
// statement: a federal servicer paid at least twice lately, not on autopay as far as the line says,
// never a private lender, and nothing after December 31.

const payments = (description: string, amountCents = 21_240) =>
  ["2026-09-05", "2026-10-05", "2026-11-05"].map((date) => ({
    date,
    amountCents,
    description,
    pfc: "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT",
    accountId: "chk",
  }));

const card = (lines: ProfileInput["transactions"], today = "2026-11-16") => {
  const base = inputFor("renter");
  const data: ProfileInput = {
    ...base,
    today,
    liabilities: [],
    transactions: [
      ...base.transactions.filter((t) => t.pfc !== "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT"),
      ...lines,
    ],
  };
  return runDetectors({ profile: buildProfile(data), data }, STUDENT_AID_DETECTORS).find(
    (s) => s.topic === "student_autopay",
  );
};

describe("the federal autopay card from a statement alone", () => {
  it("shows for a student paying a federal servicer, with the date, the cut, how sure and the steps", () => {
    const s = card(payments("NELNET DES:STUDENT LN ID:XXXXX55 INDN:SAMPLE STUDENT"))!;
    expect(s).toBeDefined();
    expect(s.short).toBe(
      "Autopay with Nelnet by December 31, 2026 takes 1% off a federal loan's rate.",
    );
    expect(s.why).toContain("11:59 p.m. Eastern on December 31, 2026");
    expect(s.why).toContain("through June 30, 2028");
    expect(s.why).toContain("about $10 a year for every $1,000 owed");
    expect(s.why).toContain("turn on Auto Pay");
    expect(s.confidence.percent).toBeGreaterThan(0);
    expect(s.confidence.reason).toContain("I can't see the loans, or whether autopay is on");
    expect(s.more).toContainEqual({
      label: "Sign in to Nelnet",
      href: "https://nelnet.studentaid.gov",
    });
    // What's owed isn't on file: no figure is made up.
    expect(s.worthCents).toBe(0);
    expect(s.headline).toBe("Turn on student loan autopay");
  });

  it("is shown to real accounts: a fact and the servicer's own page, not advice", () => {
    const s = card(payments("MOHELA DES:LOAN PMT"))!;
    expect(ADVICE_TOPICS as readonly string[]).not.toContain(s.topic);
    expect([s.title, s.headline, s.short, s.why].filter(tellsThemToAct)).toEqual([]);
    // MOHELA also services private loans: the card doesn't call the loan federal.
    expect(s.why).toContain("MOHELA also services some");
  });

  it("names the servicer generically when the bank prints the Education Department", () => {
    const s = card(payments("DEPT EDUCATION DES:STUDENT LN ID:XXXXX12"))!;
    expect(s.short).toContain("with your loan servicer");
    expect(s.more?.map((m) => m.href)).toEqual(["https://studentaid.gov/aid-summary/loans"]);
  });

  it("stays away from someone whose payment line says autopay", () => {
    expect(card(payments("NELNET DES:AUTOPAY ID:XXXXX55"))).toBeUndefined();
    expect(card(payments("AIDVANTAGE AUTO PAY"))).toBeUndefined();
  });

  it("stays away from private loans", () => {
    expect(card(payments("SALLIE MAE BANK DES:PAYMENT"))).toBeUndefined();
    expect(card(payments("SOFI LENDING DES:MOHELA PMT"))).toBeUndefined();
    expect(card(payments("NAVIENT ONLINE PMT"))).toBeUndefined();
  });

  it("needs two recent payments, and says nothing after December 31", () => {
    expect(card(payments("MOHELA DES:LOAN PMT").slice(0, 1))).toBeUndefined();
    expect(card(payments("MOHELA DES:LOAN PMT"), "2027-01-01")).toBeUndefined();
    expect(card(payments("MOHELA DES:LOAN PMT"))).toBeDefined();
  });
});

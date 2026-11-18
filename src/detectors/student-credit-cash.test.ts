import { describe, expect, it, vi } from "vitest";
import { tellsThemToAct } from "@/lib/real-account-text";
import { HEADLINE_VERBS } from "@/config/detectors";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import {
  CHASE_OVERDRAFT,
  CREDIT_START,
  OVERDRAFT_OPT_IN,
  STUDENT_ACCOUNTS,
} from "@/config/student-money";
import { PEOPLE } from "@/config/people";
import { checkGuardrails, dollarFigures, recommendsAChoice } from "@/lib/guardrails";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { HEADLINE_MAX, SHORT_MAX, type Suggestion } from "./contract";
import { DETECTORS, runDetectors } from "./index";
import { STUDENT_CREDIT_CASH_DETECTORS } from "./student-credit-cash";
import { grad, undergrad } from "./__fixtures__/students";

// Suggest-money lane (11-18): no credit file building yet, a checking fee the same bank's account
// for young owners doesn't charge, and the overdraft opt-out on the bank-fees card.

const fire = (data: ProfileInput, topic: string, detectors = STUDENT_CREDIT_CASH_DETECTORS) =>
  runDetectors({ profile: buildProfile(data), data }, detectors).find((s) => s.topic === topic) ??
  null;

function expectClean(s: Suggestion) {
  for (const text of [s.title, s.headline, s.short, s.why]) {
    expect(
      checkGuardrails(
        text,
        dollarFigures(text).map((f) => f.cents),
      ),
      text,
    ).toEqual({
      ok: true,
    });
    expect(recommendsAChoice(text), text).toBe(false);
    // Real-account text never tells them what to do with money (src/lib/real-account-text.ts).
    expect(tellsThemToAct(text), text).toBe(false);
  }
  expect(s.headline.length).toBeLessThanOrEqual(HEADLINE_MAX);
  expect(HEADLINE_VERBS, s.headline).toContain(s.headline.split(" ")[0]);
  expect(s.short.length).toBeLessThanOrEqual(SHORT_MAX);
}

describe("a credit file that hasn't started", () => {
  it("tells a student with only checking and no card or loan payment how a file starts, with costs", () => {
    const s = fire(undergrad(), "credit_file_start")!;
    expect(s).not.toBeNull();
    expect(s.why).toContain("$50 to $300");
    expect(s.why).toContain("$300 to $1,000");
    expect(s.why).toContain("6 to 24 months");
    expect(s.why).toContain("annualcreditreport.com");
    expect(s.more?.map((m) => m.href)).toEqual([CREDIT_START.url, CREDIT_START.reportUrl]);
    expect(s.worthCents).toBe(0);
    // Never surer than "I can't see your credit report" allows.
    expect(s.confidence.percent).toBeLessThanOrEqual(60);
    expectClean(s);
  });

  it("is nothing with a card account, a loan, or a payment to a card from checking", () => {
    expect(fire(grad(), "credit_file_start")).toBeNull();
    const base = undergrad();
    const pays = (description: string, pfc: string): ProfileInput => ({
      ...base,
      transactions: [
        ...base.transactions,
        { date: "2026-11-10", amountCents: 5_000, description, pfc, accountId: "ug-checking" },
      ],
    });
    expect(
      fire(pays("CAPITAL ONE ONLINE PMT", "TRANSFER_OUT_ACCOUNT_TRANSFER"), "credit_file_start"),
    ).toBeNull();
    expect(
      fire(pays("DISCOVER E-PAYMENT", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"), "credit_file_start"),
    ).toBeNull();
    expect(
      fire(pays("NELNET STUDENT LN", "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT"), "credit_file_start"),
    ).toBeNull();
    expect(
      fire(
        {
          ...base,
          liabilities: [
            { accountId: "x", kind: "student", aprBps: 500, hasPmi: null, payoffDate: null },
          ],
        },
        "credit_file_start",
      ),
    ).toBeNull();
  });

  it("needs a month of data, and someone young: a student, under 30, or starting out", () => {
    const base = undergrad();
    // 29 days of data: too little to say no card is paid.
    const short = {
      ...base,
      transactions: base.transactions.filter((t) => t.date >= "2026-10-20"),
    };
    expect(fire(short, "credit_file_start")).toBeNull();
    const month = {
      ...base,
      transactions: base.transactions.filter((t) => t.date >= "2026-10-19"),
    };
    expect(fire(month, "credit_file_start")).not.toBeNull();
    // Told an age of 45: not someone starting out.
    expect(fire({ ...base, told: { age: 45 } }, "credit_file_start")).toBeNull();
    expect(fire({ ...base, told: { age: 29 } }, "credit_file_start")).not.toBeNull();
    // Not a student and nothing else says young: nothing.
    const notStudent = {
      ...base,
      transactions: base.transactions.filter((t) => !/BOOKSTORE|CAMPUS/.test(t.description)),
    };
    const p = buildProfile(notStudent).facts;
    if (p.age_band.value !== "under_30" && p.life_stage.value !== "starting") {
      expect(fire(notStudent, "credit_file_start")).toBeNull();
    }
  });
});

describe("a checking fee the same bank's account for young owners doesn't charge", () => {
  it("names the bank's own account and rule, worth the fee for a year", () => {
    const s = fire(undergrad(), "student_checking")!;
    expect(s).not.toBeNull();
    expect(s.worthCents).toBe(1_200 * 12);
    expect(s.title).toContain("Chase has Chase Secure Banking");
    // A fact about their own bank, no imperative (chat-tests wording check, 11-18).
    expect(s.why).not.toMatch(/move you to|ask Chase/);
    expect(s.why).toContain("Its page says how to open it");
    expect(s.why).toContain("aged 17 to 24");
    expect(s.why).toContain("which I don't have");
    expect(s.why).toContain("1 overdraft fee");
    expect(s.action.href).toBe(STUDENT_ACCOUNTS[0].url);
    expect(s.watch).toMatchObject({ kind: "fee_stops", monthlyCents: 1_200 });
    expectClean(s);
  });

  it("knows the bank from an upload's account name too, and Bank of America's under-25 rule", () => {
    const base = undergrad();
    const bofa: ProfileInput = {
      ...base,
      accounts: [{ ...base.accounts[0]!, institution: null, name: "Bank of America checking" }],
    };
    const s = fire(bofa, "student_checking")!;
    expect(s.title).toContain("Advantage SafeBalance");
    expect(s.why).toContain("under 25");
  });

  it("is nothing at a bank with no such account, for a told age outside the rule, or with no recent fee", () => {
    const base = undergrad();
    const other = {
      ...base,
      accounts: [{ ...base.accounts[0]!, institution: "Golden 1", name: "Checking" }],
    };
    expect(fire(other, "student_checking")).toBeNull();
    expect(fire({ ...base, told: { age: 25 } }, "student_checking")).toBeNull();
    const at24 = fire({ ...base, told: { age: 24 } }, "student_checking")!;
    expect(at24.why).not.toContain("which I don't have");
    expect(fire({ ...base, told: { age: 16 } }, "student_checking")).toBeNull();
    // The fee 62 days back still counts; 63 days back it doesn't.
    expect(fire({ ...base, today: "2027-01-01" }, "student_checking")).not.toBeNull();
    expect(fire({ ...base, today: "2027-01-02" }, "student_checking")).toBeNull();
  });

  it("is nothing for someone not known to be a student", () => {
    const base = undergrad();
    const plain = {
      ...base,
      transactions: base.transactions.filter((t) => !/BOOKSTORE|CAMPUS/.test(t.description)),
    };
    expect(fire(plain, "student_checking")).toBeNull();
  });
});

describe("the overdraft opt-out on the bank-fees card", () => {
  it("is said, with the rule's page, when an overdraft fee was paid", () => {
    const s = fire(undergrad(), "bank_fees", DETECTORS)!;
    expect(s.why).toContain("need your opt-in");
    expect(s.more?.map((m) => m.href)).toEqual([
      OVERDRAFT_OPT_IN.consumerUrl,
      OVERDRAFT_OPT_IN.url,
      CHASE_OVERDRAFT.url,
    ]);
    // The undergraduate banks at Chase: Chase's own $50 rule.
    expect(s.why).toContain("overdrawn by $50 or less");
    expectClean(s);
  });

  it("isn't, when the fees were never an overdraft", () => {
    const base = undergrad();
    const data = {
      ...base,
      transactions: base.transactions.filter((t) => t.pfc !== "BANK_FEES_OVERDRAFT_FEES"),
    };
    const s = fire(data, "bank_fees", DETECTORS)!;
    expect(s.why).not.toContain("opt-in");
    expect(s.why).not.toContain("Chase's own rule");
    expect(s.more).toBeUndefined();
  });
});

describe("the sample people", () => {
  it("get none of these (none is a student with only checking or a student-account bank fee)", () => {
    for (const p of PEOPLE) {
      const data = inputFor(p.id);
      const fired = runDetectors(
        { profile: buildProfile(data), data },
        STUDENT_CREDIT_CASH_DETECTORS,
      );
      expect(fired.map((s) => `${p.id}:${s.topic}`)).toEqual([]);
    }
  });
});

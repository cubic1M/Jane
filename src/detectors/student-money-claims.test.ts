import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput, type ProfileTx } from "@/profile/build";
import { runDetectors } from "./index";
import { STUDENT_MONEY_DETECTORS, cashClearsCard } from "./student-money";
import { grad, undergrad } from "./__fixtures__/students";

// CodeRabbit sweep 1c, det-04: the cash pace is measured over the cash accounts' own history, the
// Stanford bill's dates follow the student's program (both when it isn't known), and a partial card
// payoff across several cards quotes no saving.

const fire = (data: ProfileInput, topic: string) =>
  runDetectors({ profile: buildProfile(data), data }, STUDENT_MONEY_DETECTORS).find(
    (s) => s.topic === topic,
  ) ?? null;

const row = (
  date: string,
  amountCents: number,
  description: string,
  pfc: string,
  accountId = "ug-checking",
): ProfileTx => ({ date, amountCents, description, pfc, accountId });

const bill = row(
  "2026-10-19",
  420_000,
  "STANFORD UNIV STUDENT ACCT EPAY",
  "GENERAL_SERVICES_EDUCATION",
);

describe("cash pace over cash history (finding 2)", () => {
  it("makes no forecast from four days of cash history beside 60 days of card history", () => {
    const base = undergrad();
    const data: ProfileInput = {
      ...base,
      today: "2026-11-24",
      told: { is_student: true },
      accounts: [
        { ...base.accounts[0]!, balanceCents: 42_000 },
        { id: "card", type: "credit", subtype: "credit card", balanceCents: 0 },
      ],
      transactions: [
        // The older card rows and the bill paid on the card start the history; cash starts later.
        row("2026-09-20", 1_500, "SAFEWAY", "FOOD_AND_DRINK_GROCERIES", "card"),
        { ...bill, accountId: "card" },
        ...base.transactions.filter((t) => t.date >= "2026-11-17"),
        row("2026-11-20", 2_000, "STANFORD CAMPUS DINING", "FOOD_AND_DRINK_RESTAURANT"),
      ],
    };
    expect(fire(data, "bill_gap_ahead")).toBeNull();
  });
});

describe("Stanford's billing calendar (finding 16)", () => {
  const payingBill = (told: ProfileInput["told"]): ProfileInput => {
    const base = undergrad();
    return {
      ...base,
      today: "2026-12-10",
      told: { is_student: true, ...told },
      accounts: [{ ...base.accounts[0]!, balanceCents: 42_000 }],
      transactions: [
        ...base.transactions,
        bill,
        row("2026-11-20", 2_000, "STANFORD CAMPUS DINING", "FOOD_AND_DRINK_RESTAURANT"),
        row("2026-12-08", 2_000, "STANFORD CAMPUS DINING", "FOOD_AND_DRINK_RESTAURANT"),
      ],
    };
  };

  it("uses the graduate dates for a graduate student", () => {
    const s = fire(payingBill({ enrollment: "grad" }), "bill_gap_ahead")!;
    expect(s.title).toContain("January 20");
    expect(s.title).not.toContain("December 17");
    expect(s.why).toContain("for graduate students");
  });

  it("uses the undergraduate dates, with no graduate January note, for an undergraduate", () => {
    const s = fire(payingBill({ enrollment: "undergrad" }), "bill_gap_ahead")!;
    expect(s.title).toContain("December 17");
    expect(s.why).toContain("for undergraduates");
    expect(s.why).not.toContain("January 20");
  });

  it("shows both dates, and one forecast as no one's deadline, when the program isn't known", () => {
    const s = fire(payingBill({}), "bill_gap_ahead")!;
    expect(s.title).toContain("December 17");
    expect(s.why).toContain("December 17 for undergraduates");
    expect(s.why).toContain("January 20 for graduate students");
    expect(s.why).toContain("which applies depends on your program");
  });
});

describe("a partial payoff across cards (finding 8)", () => {
  it("quotes no saving when cash covers only part of two cards' balances", () => {
    const base = grad();
    const data: ProfileInput = {
      ...base,
      accounts: [
        ...base.accounts.map((a) =>
          a.type === "depository"
            ? { ...a, balanceCents: a.subtype === "savings" ? 0 : 400_000 }
            : a,
        ),
        {
          id: "grad-card-2",
          name: "Zero percent card",
          type: "credit",
          subtype: "credit card",
          balanceCents: 900_000,
          limitCents: 1_000_000,
        },
      ],
      liabilities: [
        ...base.liabilities,
        { accountId: "grad-card-2", kind: "credit", aprBps: 0, hasPmi: null, payoffDate: null },
      ],
    };
    expect(cashClearsCard(data)).toBeNull();
    expect(fire(data, "card_from_cash")).toBeNull();
  });

  it("still quotes the saving for one card, and for two when cash clears both", () => {
    const base = grad();
    const one = {
      ...base,
      accounts: base.accounts.map((a) =>
        a.type === "depository" ? { ...a, balanceCents: a.subtype === "savings" ? 0 : 400_000 } : a,
      ),
    };
    expect(cashClearsCard(one)!.interestCents).toBeGreaterThan(0);
    expect(cashClearsCard(base)!.interestCents).toBeGreaterThan(0);
  });
});

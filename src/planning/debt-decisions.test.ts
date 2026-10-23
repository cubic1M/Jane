import { describe, expect, it } from "vitest";
import {
  DECISIONS,
  closeCard,
  rentOrBuy,
  saveEachMonth,
  consolidate,
  payOrInvest,
  paydayLoan,
  payoffHurts,
  bnpl,
  overdraft,
  personalLoan,
  savingsOrDebt,
  studentEarly,
  type DecisionInput,
} from "./debt-decisions";

const base: DecisionInput = {
  advice: true,
  cards: [
    { name: "Store Card", balanceCents: 149_000, aprBps: 3_199, limitCents: 200_000 },
    { name: "Card A", balanceCents: 472_000, aprBps: 2_999, limitCents: 500_000 },
  ],
  mortgage: null,
  student: { name: "Student Loan", balanceCents: 1_834_500, aprBps: 549 },
  liquidCents: 900_000,
  monthlySpendCents: 300_000,
  consolidation: { name: "Northstar Slate", kind: "transfer", aprBps: 0, savesCents: 166_797 },
  personalLoan: { name: "Clearwater", kind: "personal", aprBps: 1_199, savesCents: 90_000 },
  nextPayday: { date: "Nov 1", days: 14 },
};
const noAdvice = { ...base, advice: false };
const sentences = (text: string[]) => text.join(" ").split(/(?<=[.!?])\s+/);

describe("every decision answers in three sentences or fewer, with the person's numbers", () => {
  for (const [id, decide] of Object.entries(DECISIONS)) {
    for (const advice of [true, false]) {
      it(`${id} (${advice ? "demo advice" : "math only"})`, () => {
        const d = decide({ ...base, advice });
        expect(d.sentences.length).toBeGreaterThan(0);
        expect(d.sentences.length).toBeLessThanOrEqual(3);
        for (const s of d.sentences) {
          expect(s.endsWith(".")).toBe(true);
          expect(s.match(/\.\s/g)?.length ?? 0, s).toBe(0);
        }
        expect(d.href.startsWith("/")).toBe(true);
      });
    }
  }
});

describe("pay a card or invest", () => {
  it("compares the card's rate with investing's range and picks the card in demo advice", () => {
    const d = payOrInvest(base);
    expect(d.sentences[0]).toMatch(
      /^Store Card costs 31\.99% a year on \$1,490\.00, and investing has/,
    );
    expect(d.sentences[1]).toBe(
      "Paying it down is a certain 31.99% return, more than investing's usual best, so I'd pay it off first.",
    );
    expect(d.sentences[2]).toBe(
      "You can put $1,490.00 toward it now and still keep your $3,000.00 emergency cushion.",
    );
    expect(d.advice).toBe(true);
  });
  it("stops at the math when it isn't demo advice", () => {
    const d = payOrInvest(noAdvice);
    expect(d.sentences).toHaveLength(2);
    expect(d.sentences[1]).toBe(
      "Paying it down earns exactly 31.99%, certain; investing is a range that can lose.",
    );
    expect(d.advice).toBe(false);
    expect(d.sentences.join(" ")).not.toMatch(/\bI'd\b/);
  });
  it("calls a low-rate debt a closer call, and warns when cash is thin", () => {
    const d = payOrInvest({
      ...base,
      cards: [{ name: "Card", balanceCents: 100_000, aprBps: 600, limitCents: null }],
      liquidCents: 100_000,
    });
    expect(d.sentences[1]).toMatch(/near investing's range/);
    expect(d.sentences[2]).toBe("Keep about $3,000.00 in cash before either.");
  });
  it("uses the mortgage when there are no cards, and says so when there is no debt", () => {
    const m = payOrInvest({
      ...base,
      cards: [],
      mortgage: { name: "Home Loan", balanceCents: 30_000_000, aprBps: 650 },
    });
    expect(m.sentences[0]).toMatch(/^Home Loan costs 6\.5% a year on \$300,000\.00/);
    expect(payOrInvest({ ...base, cards: [] }).sentences).toEqual([
      "I don't see a debt with a balance, so there's nothing to pay down.",
    ]);
  });
});

describe("consolidate and a personal loan", () => {
  it("names the best offer and what it saves, fees counted", () => {
    const d = consolidate(base);
    expect(d.sentences[0]).toBe("You owe $6,210.00 across 2 cards at 30.47% on average.");
    expect(d.sentences[1]).toBe(
      "Northstar Slate at 0% would save about $1,667.97 in all, fees counted.",
    );
    expect(sentences(personalLoan(base).sentences)[1]).toMatch(
      /Clearwater at 11\.99% would save about \$900\.00/,
    );
  });
  // Loans QA: a 0% card left out for a score those cards don't usually approve is said, not
  // picked.
  it("says why a 0% transfer card isn't the pick for a low score", () => {
    const d = consolidate({
      ...base,
      consolidation: null,
      personalLoan: null,
      transferNeedsScore: { score: 560, minScore: 670 },
    });
    expect(d.sentences[1]).toBe(
      "A 0% transfer card would cost less, but those usually need a score of 670 or more and yours is 560; no loan beats your rates once fees are counted.",
    );
    expect(d.sentences[2]).toMatch(/highest-rate card first/);
    expect(d.sentences.join(" ")).not.toMatch(/I'd do it/);
  });

  it("says there's no offer worth taking when none saves, and the math only when not demo advice", () => {
    const none = { ...base, consolidation: null, personalLoan: null };
    expect(consolidate(none).sentences[1]).toMatch(/beats your current rates once its fees/);
    expect(consolidate(none).sentences[2]).toMatch(/highest-rate card first/);
    expect(consolidate({ ...noAdvice, consolidation: null }).sentences).toHaveLength(2);
    expect(personalLoan({ ...noAdvice }).sentences.at(-1)).toBe(
      "That's the math; the choice is yours.",
    );
  });
});

describe("savings or debt", () => {
  it("puts what's beyond a month of spending on the worst card and says what it saves a year", () => {
    const d = savingsOrDebt(base);
    expect(d.sentences[0]).toBe(
      "You have $9,000.00 in cash and $6,210.00 on cards, the worst at 31.99%.",
    );
    expect(d.sentences[1]).toBe(
      "Putting $6,000.00 on Store Card saves about $1,919.40 a year in interest and still keeps your $3,000.00 emergency cushion.",
    );
  });
  it("has nothing spare when cash is under a month of spending", () => {
    const d = savingsOrDebt({ ...base, liquidCents: 200_000 });
    expect(d.sentences[1]).toMatch(/under your \$3,000\.00 emergency cushion/);
  });
});

describe("closing a card and paying one off", () => {
  it("shows what closing the smallest card does to limits and use", () => {
    const d = closeCard(base);
    expect(d.sentences[0]).toBe(
      "Closing Store Card would cut your limits from $7,000.00 to $5,000.00, taking your card use from 89% to 124%.",
    );
    expect(d.sentences[1]).toMatch(/stays on your report for about 10 years/);
    expect(d.sentences[2]).toBe("I'd keep it open unless it charges a fee.");
  });
  it("can't say by how much without limits", () => {
    const d = closeCard({ ...base, cards: base.cards.map((c) => ({ ...c, limitCents: null })) });
    expect(d.sentences[1]).toBe("I don't know your card limits yet, so I can't say by how much.");
  });
  it("says plainly that paying off doesn't hurt", () => {
    const d = payoffHurts(base);
    expect(d.sentences[0]).toMatch(/^No: paying a card off doesn't hurt your credit/);
    expect(d.sentences[1]).toBe(
      "Paying all your cards off would take your use from 89% to 0% of $7,000.00.",
    );
    expect(d.advice).toBe(false);
  });
});

describe("a payday loan", () => {
  it("gives its yearly rate and the person's next payday, and the cheaper ways first in demo advice", () => {
    const d = paydayLoan(base);
    expect(d.sentences[0]).toBe(
      "A payday loan usually costs about 15% of what you borrow for two weeks, which is around 391% a year.",
    );
    expect(d.sentences[1]).toBe("Your next payday is Nov 1, 14 days away.");
    expect(d.sentences[2]).toMatch(/so I'd try those first\.$/);
    expect(paydayLoan(noAdvice).sentences[2]).not.toMatch(/\bI'd\b/);
  });
  it("copes with no known payday", () => {
    expect(paydayLoan({ ...base, nextPayday: null }).sentences).toHaveLength(2);
  });
});

describe("a student loan early", () => {
  it("compares the loan's rate with investing and keeps federal protections in view", () => {
    const d = studentEarly(base);
    expect(d.sentences[0]).toMatch(/^Student Loan is \$18,345\.00 at 5\.49%, and investing has/);
    expect(d.sentences[1]).toMatch(/within investing's range/);
    expect(d.sentences[2]).toBe(
      "If it's federal and you may qualify for forgiveness, don't pay it off early.",
    );
    expect(
      studentEarly({ ...base, student: { name: "Loan", balanceCents: 100_000, aprBps: 900 } })
        .sentences[1],
    ).toMatch(/above investing's usual best/);
  });
  it("asks for the rate when it's missing, and has nothing without a loan", () => {
    expect(
      studentEarly({ ...base, student: { name: "Loan", balanceCents: 100_000, aprBps: null } })
        .sentences[0],
    ).toBe("You owe $1,000.00 on Loan, but I don't have its rate.");
    expect(studentEarly({ ...base, student: null }).sentences[0]).toMatch(/nothing to pay down/);
  });
});

describe("will I overdraft this month", () => {
  const forecast = (
    negative: { date: string; balanceCents: number } | null,
    savingsCents = 50_000,
  ) => ({
    ...base,
    forecast: {
      firstNegative: negative,
      lowest: negative ?? { date: "Nov 3", balanceCents: 21_000 },
      savingsCents,
    },
  });
  it("says yes with the day and the amount, and what covers it", () => {
    const d = overdraft(forecast({ date: "Nov 3", balanceCents: -21_180 }));
    expect(d.sentences).toEqual([
      "Yes: your checking is forecast to go $211.80 below zero on Nov 3.",
      "Your savings could cover the $211.80.",
      "Move $211.80 over before Nov 3 so no overdraft fee hits.",
    ]);
  });
  it("points to the lenders when savings can't cover it, and stops at the math without demo advice", () => {
    const d = overdraft(forecast({ date: "Nov 3", balanceCents: -21_180 }, 1_000));
    expect(d.sentences[1]).toBe("Your savings of $10.00 wouldn't fully cover it.");
    expect(d.sentences[2]).toBe("Ask each lender to move a due date after payday before it hits.");
    expect(
      overdraft({ ...forecast({ date: "Nov 3", balanceCents: -21_180 }), advice: false }).sentences,
    ).toHaveLength(2);
  });
  it("says no with the lowest point, and can't say without a checking account", () => {
    const d = overdraft(forecast(null));
    expect(d.sentences[0]).toBe(
      "No: your checking stays above zero for the next month, dipping lowest to $210.00 on Nov 3.",
    );
    expect(d.sentences[1]).toBe(
      "That's with your bills and installments counted, and your next payday is Nov 1.",
    );
    expect(overdraft({ ...base, forecast: null }).sentences[0]).toMatch(
      /can't see a checking account/,
    );
  });
});

describe("buy now, pay later", () => {
  it("says when it's free, what the person has, and what to do next", () => {
    const d = bnpl({ ...base, bnpl: { plans: 2, monthlyCents: 12_000 } });
    expect(d.sentences[0]).toMatch(
      /^A Pay in 4 plan costs nothing extra if every payment lands on time/,
    );
    expect(d.sentences[1]).toBe("You have 2 plans now, $120.00 a month in installments.");
    expect(d.sentences[2]).toMatch(/check it against your forecast\.$/);
    expect(bnpl({ ...base, bnpl: { plans: 0, monthlyCents: 0 } }).sentences[1]).toBe(
      "You have no buy now, pay later plan right now.",
    );
    expect(bnpl({ ...noAdvice, bnpl: null }).sentences[2]).toBe(
      "Tell me the total and I'll check it against your forecast.",
    );
  });
});

describe("how much to save each month", () => {
  const withIncome = { ...base, incomeCents: 500_000, savingCents: 40_000 };
  it("sets what they keep against 20% of take-home, and puts a high-rate card first in demo advice", () => {
    const d = saveEachMonth(withIncome);
    expect(d.sentences).toEqual([
      "You keep about $400.00 a month now, 8% of the $5,000.00 you take home.",
      "A common target is 20%, $1,000.00 a month, which is $600.00 more than you save now.",
      "With Store Card at 31.99%, put the first $1,000.00 toward it each month before saving elsewhere.",
    ]);
  });
  it("says they already beat it, stops at the math without demo advice, and wants income first", () => {
    expect(saveEachMonth({ ...withIncome, savingCents: 150_000 }).sentences[1]).toMatch(
      /you already beat it\.$/,
    );
    expect(saveEachMonth({ ...withIncome, advice: false }).sentences).toHaveLength(2);
    expect(
      saveEachMonth({ ...base, cards: [], incomeCents: 500_000, savingCents: 0 }).sentences[2],
    ).toMatch(/three months of spending first/);
    expect(saveEachMonth(base).sentences[0]).toMatch(/^I need to see a few months of income/);
  });
});

describe("rent or buy", () => {
  const home = { maxPriceCents: 25_000_000, housingCents: 180_000, cashNeededCents: 3_250_000 };
  it("sets the rent against the home the 28/36 rules allow and says how long buying takes to pay", () => {
    const d = rentOrBuy({ ...base, rentCents: 145_000, home });
    expect(d.sentences[0]).toBe(
      "You pay $1,450.00 a month in rent; a home up to $250,000.00, the most the usual 28/36 rules allow, would cost about $1,800.00 a month with taxes and insurance.",
    );
    expect(d.sentences[1]).toBe(
      "You'd also need about $32,500.00 up front, and buying tends to beat renting only if you stay 5 years or more.",
    );
    expect(d.sentences[2]).toBe(
      "That's $350.00 a month more than your rent, so renting is cheaper unless you'll stay many years.",
    );
  });
  it("is the math alone without demo advice, copes with no rent, and wants income", () => {
    expect(rentOrBuy({ ...noAdvice, rentCents: 145_000, home }).sentences).toHaveLength(2);
    expect(rentOrBuy({ ...base, rentCents: null, home }).sentences[0]).toMatch(
      /^A home up to \$250,000\.00/,
    );
    expect(
      rentOrBuy({ ...base, rentCents: 145_000, home: { ...home, housingCents: 120_000 } })
        .sentences[2],
    ).toMatch(/no more than your rent/);
    expect(rentOrBuy({ ...base, home: null }).sentences[0]).toMatch(
      /^I need a few months of income/,
    );
  });
});

describe("when cash alone clears the cards for less than any loan", () => {
  const cash = { ...base, cashPayoffSavesCents: 240_000 };
  it("says so first in consolidate and personal loan, and picks it only in demo advice", () => {
    for (const decide of [consolidate, personalLoan]) {
      const d = decide(cash);
      expect(d.sentences[1]).toBe(
        "Your cash covers it: paying the cards off from savings would save about $2,400.00 and still keep your $3,000.00 emergency cushion.",
      );
      expect(d.sentences[2]).toBe("I'd do that instead of taking a loan.");
      expect(decide({ ...cash, advice: false }).sentences).toHaveLength(2);
    }
  });
});

// Loans QA: a card with a balance but no rate (a CSV import) is debt, not "nothing to pay down".
describe("a card owed without a rate", () => {
  const unrated = {
    ...noAdvice,
    cards: [{ name: "Card", balanceCents: 600_000, aprBps: null, limitCents: null }],
    student: null,
    consolidation: null,
    personalLoan: null,
  };
  it("asks for the rate instead of saying there's no debt, with nothing weighed", () => {
    for (const id of [
      "consolidate",
      "pay_or_invest",
      "savings_or_debt",
      "personal_loan",
    ] as const) {
      const d = DECISIONS[id](unrated);
      expect(d.sentences, id).toEqual([
        "You owe $6,000.00 on Card, but I don't have its rate.",
        "Tell me the rate (it's on the statement, as the purchase APR) and I'll work this out with your numbers.",
      ]);
      expect(d.nothingWeighed, id).toBe(true);
    }
  });
  it("still says there's nothing to pay down when nothing is owed", () => {
    const d = DECISIONS.consolidate({ ...unrated, cards: [] });
    expect(d.sentences[0]).toBe(
      "I don't see a debt with a balance, so there's nothing to pay down.",
    );
    expect(d.nothingWeighed).toBe(true);
  });
});

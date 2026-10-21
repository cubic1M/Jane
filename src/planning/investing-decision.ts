import {
  ACTIVE_FEE_BPS,
  HIGH_DEBT_APR_BPS,
  INDEX_FEE_BPS,
  MEDICARE_AGE,
  ROTH_LOW_RATE,
  SAFE_DRAW_SHARE,
  SS_AT_62_CUT,
  TRADITIONAL_HIGH_RATE,
  SINGLE_STOCK_MAX_SHARE,
  SOON_GOAL_MONTHS,
  START_SHARE,
  type DecisionKind,
} from "@/config/investing-decisions";
import { HSA_LIMITS } from "@/config/hsa";
import { RETURN_HIGH } from "@/config/market-assumptions";
import { CRYPTO_SHARE_FLAG } from "@/config/crypto";
import { formatCents } from "@/lib/money";

// Investing decisions (the chat): a direct answer of three sentences or fewer from the
// person's own numbers. Pure. The first thing in the way comes first: high-interest debt, then
// the emergency fund, then money needed soon. In demo advice mode it answers; on a real account
// it says what it sees and never what to do.

export type DecisionFacts = {
  advice: boolean;
  // Debts at or above HIGH_DEBT_APR_BPS, worst first.
  highDebts: { name: string; kind: string; balanceCents: number; aprBps: number }[];
  // The highest rate on any debt, when they have debt.
  topDebt: { name: string; aprBps: number } | null;
  emergencyTargetCents: number;
  savingsCents: number;
  investedCents: number;
  cryptoCents: number;
  soonGoal: { name: string; leftCents: number; months: number } | null;
  riskLabel: string | null;
  monthlyIncomeCents: number | null;
  // Federal tax rate on the next dollar, when Jane knows it.
  marginalRate: number | null;
  hsaCents: number;
  preTaxCents: number;
  rothCents: number;
  monthlySpendCents: number | null;
  // The age asked about ("retire at 62"), from the question.
  askedAge: number | null;
  hasFamilyPlan: boolean;
  // A 401(k) deferral seen on pay stubs this year, projected, when no account is linked.
  stubDeferralCents: number;
};

const pct = (bps: number) => `${Math.round(bps / 10) / 10}%`;

// What stands in the way, in order, as one sentence; null when nothing does.
function gate(f: DecisionFacts, what: string): string | null {
  const debt = f.highDebts[0];
  if (debt) {
    return `Not yet: you owe ${formatCents(debt.balanceCents)} at ${pct(debt.aprBps)} on your ${debt.kind}, ${debt.name}, and paying that off beats ${what}${f.emergencyTargetCents > 0 ? `, with your cushion at ${formatCents(f.savingsCents)} of ${formatCents(f.emergencyTargetCents)}` : ""}.`;
  }
  if (f.emergencyTargetCents > 0 && f.savingsCents < f.emergencyTargetCents) {
    return `Not yet: your cushion is ${formatCents(f.savingsCents)} of the ${formatCents(f.emergencyTargetCents)} I'd keep for emergencies, and that comes before ${what}.`;
  }
  return null;
}

export type DecisionAnswer = { sentences: string[]; offerCrypto: boolean };

export function decide(
  kind: DecisionKind,
  f: DecisionFacts,
  subject: string | null,
): DecisionAnswer {
  if (!f.advice) return { sentences: factsOnly(kind, f, subject), offerCrypto: false };
  switch (kind) {
    case "buy_crypto": {
      const share = CRYPTO_SHARE_FLAG;
      const name = subject ?? "crypto";
      const cap = Math.round(f.investedCents * share);
      return {
        sentences: [
          gate(f, `a bet on ${name}`) ??
            `Your debts and cushion are covered, so it's your call, and the usual limit for ${name} is about ${Math.round(share * 100)}% of what you invest, which for you is about ${formatCents(cap)}.`,
          f.cryptoCents > 0
            ? `You already hold ${formatCents(f.cryptoCents)} in crypto, so count that first.`
            : "It can fall by half in a year, so only use money you could afford to lose.",
          "I only read crypto, I never buy it.",
        ],
        offerCrypto: f.cryptoCents === 0,
      };
    }
    case "buy_stock": {
      const cap = Math.round(f.investedCents * SINGLE_STOCK_MAX_SHARE);
      const name = subject ?? "one company";
      return {
        sentences: [
          gate(f, `buying ${name}`) ??
            `Your debts and cushion are covered, so it's your call, but ${name} is a bet on one company, and about ${Math.round(SINGLE_STOCK_MAX_SHARE * 100)}% of what you invest (${formatCents(cap)} for you) is the usual limit.`,
          "A broad index fund holds thousands of companies, so one bad year for one of them barely moves it.",
          f.riskLabel
            ? `With your ${f.riskLabel.toLowerCase()} profile, keep the core in index funds and treat a single stock as the extra.`
            : "Answer my four questions about you and I'll fit this to your goals.",
        ],
        offerCrypto: false,
      };
    }
    case "index_vs_stocks": {
      const gap = Math.round(((ACTIVE_FEE_BPS - INDEX_FEE_BPS) * f.investedCents) / 10_000);
      return {
        sentences: [
          `For most people, index funds: they charge about ${pct(INDEX_FEE_BPS)} a year against about ${pct(ACTIVE_FEE_BPS)} for the average actively managed stock fund.`,
          f.investedCents > 0
            ? `On your ${formatCents(f.investedCents)} invested that gap is about ${formatCents(gap)} a year.`
            : "On every $10,000 that gap is about $35 a year.",
          `Picking individual stocks can make sense for a small slice, up to about ${Math.round(SINGLE_STOCK_MAX_SHARE * 100)}% in any one company.`,
        ],
        offerCrypto: false,
      };
    }
    case "invest_vs_debt": {
      const top = f.topDebt;
      const ceiling = Math.round(RETURN_HIGH.value * 100);
      if (!top) {
        return {
          sentences: [
            "You have no debt costing you interest, so investing isn't competing with a payoff.",
            f.emergencyTargetCents > 0 && f.savingsCents < f.emergencyTargetCents
              ? `First fill your cushion (${formatCents(f.savingsCents)} of ${formatCents(f.emergencyTargetCents)}), then invest.`
              : "Take any employer match first, since it's an instant return, then invest the rest.",
            "Start with a broad index fund and add a fixed amount each payday.",
          ],
          offerCrypto: false,
        };
      }
      const high = top.aprBps >= HIGH_DEBT_APR_BPS;
      return {
        sentences: [
          high
            ? `Pay off ${top.name} first: it costs you ${pct(top.aprBps)} a year, more than the ${ceiling}% top of the range I'd assume for investing.`
            : `Your highest rate is ${pct(top.aprBps)} on ${top.name}, below the ${ceiling}% top of the range I'd assume for investing, so it's closer than it sounds.`,
          "Take any employer match before either, since it's an instant return.",
          high
            ? "Then build your cushion, and invest once the expensive debt is gone."
            : "Keep your cushion full, then splitting extra money between the two is a fair choice.",
        ],
        offerCrypto: false,
      };
    }
    case "save_vs_invest": {
      return {
        sentences: [
          gate(f, "investing") ??
            `Your cushion is full at ${formatCents(f.savingsCents)}, so money beyond it can go to investing.`,
          f.soonGoal
            ? `Keep ${f.soonGoal.name} (${formatCents(f.soonGoal.leftCents)} still to save, due in ${f.soonGoal.months} months) in savings, since money needed within ${Math.round(SOON_GOAL_MONTHS / 12)} years shouldn't be in anything that can fall.`
            : "Money you won't need for five years or more is what investing is for.",
          "Cash for the next few years, investments for the long run.",
        ],
        offerCrypto: false,
      };
    }
    case "good_time": {
      return {
        sentences: [
          "Nobody can time it, and I won't pretend to; what I can check is whether you're ready.",
          gate(f, "investing") ??
            (f.soonGoal
              ? `You're clear on debt and your cushion, but keep ${f.soonGoal.name} out of it, since you need that money in ${f.soonGoal.months} months.`
              : "You're clear on high-interest debt and your cushion, so you're ready."),
          "Putting in a fixed amount every payday takes the timing out of it.",
        ],
        offerCrypto: false,
      };
    }
    case "sell": {
      return {
        sentences: [
          "I can't tell you when to sell, and nobody can time it.",
          "Selling in a taxable account can trigger a tax bill, and you'd be out of the market on the days it recovers.",
          f.riskLabel
            ? `If the drops scare you, that's worth checking against your ${f.riskLabel.toLowerCase()} profile rather than reacting to one week.`
            : "If the drops scare you, answer my four questions and I'll check your mix against them.",
        ],
        offerCrypto: false,
      };
    }
    case "hsa": {
      const limit = f.hasFamilyPlan ? HSA_LIMITS.familyCents : HSA_LIMITS.selfCents;
      const saved = f.marginalRate !== null ? Math.round(limit * f.marginalRate) : null;
      return {
        sentences: [
          f.hsaCents > 0
            ? `You already have an HSA with ${formatCents(f.hsaCents)} in it, so the question is how much more to put in.`
            : "Yes if your health plan is a high-deductible one that qualifies, because an HSA is the one account taxed lightly going in, growing and coming out for medical costs.",
          saved !== null
            ? `Filling it to the ${formatCents(limit)} limit would cut your federal tax by about ${formatCents(saved)} at your ${pct(Math.round(f.marginalRate! * 10_000))} rate.`
            : `The yearly limit is ${formatCents(limit)}, and every dollar in comes off your taxable income.`,
          "Check first that your plan qualifies, since you can only contribute with one that does.",
        ],
        offerCrypto: false,
      };
    }
    case "roth_vs_traditional": {
      const r = f.marginalRate;
      const lean =
        r === null
          ? null
          : r >= TRADITIONAL_HIGH_RATE
            ? "traditional"
            : r <= ROTH_LOW_RATE
              ? "Roth"
              : "a split";
      return {
        sentences: [
          lean === null
            ? "Roth pays off if your tax rate will be higher in retirement than now, and traditional if it will be lower."
            : lean === "a split"
              ? `At your ${pct(Math.round(r! * 10_000))} federal rate it's close, so a split between the two is a fair choice.`
              : `At your ${pct(Math.round(r! * 10_000))} federal rate, ${lean} usually comes out ahead: ${lean === "traditional" ? "the deduction now is worth more than tax-free withdrawals later" : "paying tax now at a low rate beats paying more later"}.`,
          f.preTaxCents + f.rothCents === 0 && f.stubDeferralCents > 0
            ? `Your pay stubs show a 401(k) deferral of about ${formatCents(f.stubDeferralCents)} this year, but no retirement account is linked, so I can't see which kind it is.`
            : f.preTaxCents + f.rothCents > 0
              ? `You hold ${formatCents(f.preTaxCents)} before tax and ${formatCents(f.rothCents)} in Roth accounts, so ${f.rothCents < f.preTaxCents ? "more Roth would balance them" : "adding before-tax money would balance them"}.`
              : "You don't have retirement accounts yet, so either one starts you off.",
          "When you can't tell, splitting between both hedges the rate you'll face.",
        ],
        offerCrypto: false,
      };
    }
    case "retire_at": {
      const age = f.askedAge;
      const have = f.preTaxCents + f.rothCents;
      if (have === 0) {
        return {
          sentences: [
            f.stubDeferralCents > 0
              ? `Your pay stubs show a 401(k) deferral of about ${formatCents(f.stubDeferralCents)} this year, but no retirement account is linked, so I can't see the balance to test that age.`
              : "I don't see retirement savings yet, so I can't show whether that age works.",
            "Link your 401(k) or IRA and I'll compare what you hold with what you spend.",
            "Social Security alone usually covers only part of a year's spending.",
          ],
          offerCrypto: false,
        };
      }
      const draw = Math.round(have * SAFE_DRAW_SHARE);
      const spend = f.monthlySpendCents !== null ? f.monthlySpendCents * 12 : null;
      return {
        sentences: [
          spend !== null
            ? `Your ${formatCents(have)} could pay about ${formatCents(draw)} a year at a ${Math.round(SAFE_DRAW_SHARE * 100)}% draw, against the ${formatCents(spend)} a year you spend now, so ${draw >= spend ? "it covers it before Social Security" : `you'd be short by about ${formatCents(spend - draw)} without it`}.`
            : `Your ${formatCents(have)} could pay about ${formatCents(draw)} a year at a ${Math.round(SAFE_DRAW_SHARE * 100)}% draw.`,
          age !== null && age < 67
            ? `Social Security taken at ${Math.max(62, age)} is about ${Math.round(SS_AT_62_CUT * 100)}% smaller for life than waiting until 67${age < MEDICARE_AGE ? `, and health cover before Medicare at ${MEDICARE_AGE} is an extra cost` : ""}.`
            : "Waiting for Social Security until 67 or later makes it bigger for life.",
          "That is a rule of thumb from your current numbers and no more.",
        ],
        offerCrypto: false,
      };
    }
    case "start": {
      const monthly =
        f.monthlyIncomeCents !== null ? Math.round(f.monthlyIncomeCents * START_SHARE) : null;
      return {
        sentences: [
          gate(f, "investing") ?? "Yes: you're clear on high-interest debt and your cushion.",
          monthly !== null
            ? `A starting point is ${Math.round(START_SHARE * 100)}% of your pay, about ${formatCents(monthly)} a month, into a broad index fund.`
            : "A starting point is about 5% of your pay into a broad index fund.",
          f.riskLabel
            ? `Your ${f.riskLabel.toLowerCase()} profile sets how much of it goes to stocks.`
            : "Answer my four questions and I'll set how much goes to stocks.",
        ],
        offerCrypto: false,
      };
    }
  }
}

// Real accounts: what Jane sees, no recommendation.
function factsOnly(kind: DecisionKind, f: DecisionFacts, subject: string | null): string[] {
  const seen: string[] = [];
  if (f.highDebts[0]) {
    seen.push(
      `you owe ${formatCents(f.highDebts[0].balanceCents)} on ${f.highDebts[0].name} at ${pct(f.highDebts[0].aprBps)}`,
    );
  }
  if (f.emergencyTargetCents > 0) {
    seen.push(
      `your savings are ${formatCents(f.savingsCents)} against about ${formatCents(f.emergencyTargetCents)} of emergency cover`,
    );
  }
  if (f.investedCents > 0) seen.push(`you have ${formatCents(f.investedCents)} invested`);
  if (kind === "hsa" && f.hsaCents > 0) seen.push(`your HSA holds ${formatCents(f.hsaCents)}`);
  if (kind === "roth_vs_traditional" || kind === "retire_at") {
    if (f.preTaxCents + f.rothCents > 0) {
      seen.push(
        `retirement accounts hold ${formatCents(f.preTaxCents)} before tax and ${formatCents(f.rothCents)} in Roth`,
      );
    }
    if (f.marginalRate !== null && kind === "roth_vs_traditional") {
      seen.push(
        `your federal rate on the next dollar is ${pct(Math.round(f.marginalRate * 10_000))}`,
      );
    }
  }
  const what =
    kind === "buy_crypto"
      ? "buy crypto"
      : kind === "hsa"
        ? "get an HSA"
        : kind === "roth_vs_traditional"
          ? "choose Roth or traditional"
          : kind === "retire_at"
            ? "retire at that age"
            : kind === "buy_stock"
              ? `buy ${subject ?? "a stock"}`
              : "make this call";
  return [
    `I can't tell you whether to ${what}, because I don't give recommendations on real accounts yet.`,
    seen.length > 0
      ? `What I can see: ${seen.join("; ")}.`
      : "I don't have your numbers to show yet.",
    kind === "buy_crypto"
      ? "I only read crypto, I never buy it."
      : "A licensed adviser is the person to ask for a recommendation.",
  ];
}

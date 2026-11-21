import type { PrismaClient } from "@/generated/prisma/client";
import { FUND_FACTS, FUND_NAMES } from "@/config/funds";
import { loadFees } from "@/lib/investments/fees";
import { formatExpenseRatio } from "@/lib/percent";
import { detect } from "@/detection/detect";
import { loadDetectionInput } from "@/detection/input";
import { withAreaStatus } from "@/lib/hub/area-status";
import { loadAreaTrees } from "@/lib/hub/area-trees";
import { loadHubAreas, loadHubTop } from "@/lib/hub/load";
import { netWorthHistory } from "@/lib/hub/net-worth-history";
import { loadStudentLoans } from "@/lib/student-loans";
import { cashFlowView, heroView, tilesView } from "@/lib/hub/view";
import { loadBnpl } from "@/lib/bnpl";
import { forecastAccounts } from "@/detection/forecast";
import { FORECAST_DAYS, PAYCHECKS_PER_MONTH } from "@/config/detection";
import { paySchedules } from "@/detection/paydays";
import { buildStreams } from "@/detection/streams";
import { policiesFromStreams } from "@/insights/found-policies";
import { loadCash } from "@/lib/investments/cash";
import { answerByRules } from "@/lib/jane-agent/answer";
import { cashReply, feesReply } from "@/lib/jane-agent/investments/replies";
import { parseIntent } from "@/lib/jane-agent/intents";
import { detectFor } from "@/lib/suggestions";
import { DETECTOR_RATES } from "@/config/detectors";
import { yearIncomeOf } from "@/detectors/helpers";
import { studentYearOf } from "@/planning/student-tax";
import { rateMonthsOf } from "@/profile/build";
import { chatToday } from "@/lib/today";
import { explainFigure } from "@/lib/figures";
import { scopedFor } from "@/lib/db-scoped";
import { flatten, type Flat } from "./diff";

// What one person sees at one moment, for the calendar sweep (gate C, mvp-ready.md): the findings
// detection would make, the suggestions and the profile behind them, Home's top and tiles as the
// page shows them, the area trees, the net worth chart and the chat's answers from rules. Reads
// only: nothing here writes, so two moments read the same data. The caller sets the clock (some
// loaders read it themselves) and passes the same moment as `now`. No Claude: the chat questions
// go to the rules, as with no key.

// Questions a student asks about their own money, answered without Claude.
export const CASH_QUESTION = "how much cash do I have";
const FEES_QUESTION = "what fees am I paying on my investments";
export const SWEEP_QUESTIONS = [
  "what's safe to spend",
  "how much did I spend this month",
  "what bills are coming up",
  "when do I get paid",
  "how much is my paycheck",
  "what subscriptions do I pay for",
  "what's my net worth",
  "what did you find",
  "what should I do first",
  "which bills have I paid this month",
] as const;

export async function snapshotAt(
  userId: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<Flat> {
  const asOf = await chatToday(userId, { client, now });
  const detected = detect(await loadDetectionInput(userId, { client, now }));
  const found = await detectFor(userId, { client, now });
  const top = await loadHubTop(userId, { client, now });
  const areas = top
    ? await loadHubAreas(
        userId,
        {
          budgetsOver: top.home.budgetsOver.length,
          safeShort: (top.home.safeToSpend?.safeCents ?? 0) < 0,
        },
        { client, now },
      )
    : null;
  const worth = top?.hero.netWorth?.todayCents ?? null;
  const chat: Record<string, unknown> = {};
  for (const question of SWEEP_QUESTIONS) {
    const reply = await answerByRules(userId, parseIntent(question, asOf), { client, now }).catch(
      (error: unknown) => ({ failed: error instanceof Error ? error.message : String(error) }),
    );
    chat[question] = reply;
  }
  // The chat's fees answer, and each fund it or a card may name with its yearly cost as Jane's
  // fund table has it: class 4 holds every ratio shown to the table's (./invariants.ts fundRatios).
  const { investments, fees } = await loadFees(userId, { client, now });
  chat[FEES_QUESTION] = feesReply(fees, false);
  const named = new Map<string, string>(Object.entries(FUND_NAMES).filter(([t]) => FUND_FACTS[t]));
  for (const h of investments.accounts.flatMap((a) => a.holdings))
    if (h.ticker && FUND_FACTS[h.ticker]) named.set(h.ticker, h.name);
  const funds = [...named].map(([ticker, name]) => ({
    ticker,
    name,
    ratio: formatExpenseRatio(FUND_FACTS[ticker]!.expenseRatioBps),
  }));
  // The chat's cash answer (cashReply, as "how much cash do I have" gets it), with the places it
  // adds up: class 4 holds its checking to Home's (src/sweep/invariants.ts sameFigures).
  const cash = await loadCash(userId, { client, now });
  // What decides from cash, beside what it decides: checking as the bank or statement shows it, and
  // each pay-later plan's payoff (class 4's decision side, src/sweep/invariants.ts).
  const input = await loadDetectionInput(userId, { client, now });
  const onFile = await onFileOf(userId, client, input.transactions);
  const statementCents = forecastAccounts(input, FORECAST_DAYS)[0]?.startCents ?? null;
  const bnpl = await loadBnpl(userId, { client, now, input });
  chat[CASH_QUESTION] = cashReply(cash);
  const trees = await loadAreaTrees(userId);
  // The page the student loan card opens (/loans/student): the year of pay its plans use and what
  // each income-driven plan asks a month. Class 4 holds the card's figures to it (./invariants.ts).
  const student = await loadStudentLoans(userId, { client, now });
  const studentPlans = Object.fromEntries(
    (student.comparison?.results ?? []).map((r) => [r.plan, r.monthlyNowCents]),
  );
  // Income as the profile has it a month, as the chat gives it, and as the tax cards read the year
  // (yearIncomeOf), and whether the year is that same pay: every deposit is pay, from this year,
  // with no gig pay or fellowship (class 4, src/sweep/invariants.ts sameFigures).
  const monthly = found.profile.facts.monthly_income;
  const year = studentYearOf(found.input, found.profile.facts, rateMonthsOf(found.profile));
  const deposits = found.input.transactions.filter(
    (t) => t.amountCents < 0 && t.pfc?.startsWith("INCOME_"),
  );
  const thisYear = `${found.input.today.slice(0, 4)}-01-01`;
  const incomeFigure = await explainFigure(userId, "monthly_income", { client, now });
  // The backup chat's answers to what they make: their figures only, held to the profile's month and
  // the tax cards' year (class 4). Not the text: how many months of data it says moves with the day.
  const said = async (question: string, figure: RegExp) => {
    const reply = await answerByRules(userId, parseIntent(question, asOf), { client, now });
    return reply ? (figure.exec(reply.body)?.[1] ?? null) : null;
  };
  const chatMonth = await said("how much do I make a month", /(\$[\d,]+\.\d{2}) a month/);
  const chatYearGross = await said(
    "how much do I make a year",
    /about (\$[\d,]+\.\d{2}) before tax/,
  );
  return flatten({
    onFile,
    asOf,
    detected: Object.fromEntries(detected.map((c) => [`${c.type}:${c.key}`, c])),
    suggestions: Object.fromEntries(found.suggestions.map((s) => [s.id, s])),
    profile: found.profile,
    home: top
      ? { summary: top.home, hero: heroView(top.hero), cashFlow: cashFlowView(top.cashFlow) }
      : null,
    // As Home shows them: each tile's status is its area's tree's (src/lib/hub/area-status.ts).
    tiles: areas ? withAreaStatus(tilesView(areas), trees) : null,
    trees,
    netWorth: worth === null ? null : await netWorthHistory(userId, worth, { client, now }),
    loansStudent: student.loan ? { agiCents: student.agiCents, plans: studentPlans } : null,
    chat,
    decides: {
      checkingAsShown: statementCents,
      payoffs: bnpl.plans.map((p) => ({
        name: p.name,
        balanceCents: p.balanceCents,
        canCoverPayoff: p.canCoverPayoff,
      })),
    },
    income: {
      // What the chat says for "how much do I make" and "how did you get that" (explain_figure).
      chatFigure: incomeFigure?.value ?? null,
      chatMonth,
      chatYearGross,
      // A month of pay by the schedules Home's payday and the chat's "when do I get paid" read
      // (src/detection/paydays.ts): each employer's latest paycheck times its paychecks a month.
      // Still paying is counted from where the data ends, as the profile counts it, so it doesn't
      // move with the calendar over data held still (gate C).
      scheduleMonthCents: paySchedules({
        ...input,
        asOf: input.transactions.reduce((a, t) => (t.date > a ? t.date : a), "") || input.asOf,
      })
        .filter((s) => s.active)
        .reduce((sum, s) => sum + Math.round(s.amountCents * PAYCHECKS_PER_MONTH[s.frequency]), 0),
      monthlyCents: typeof monthly.value === "number" ? monthly.value : null,
      yearCents: yearIncomeOf(found.profile, found.input),
      // Last tax year's, as a card for it reads it after it ends (the Saver's Credit in January).
      lastYearCents: yearIncomeOf(
        found.profile,
        found.input,
        Number(found.input.today.slice(0, 4)) - 1,
      ),
      // The profile's month as a year, and a bonus once (src/planning/student-tax.ts).
      fromMonthCents:
        typeof monthly.value === "number"
          ? Math.round(monthly.value * 12 * DETECTOR_RATES.tax.netToGross) + year.extraPayCents
          : null,
      payOnly:
        monthly.source !== "told" &&
        year.gigCents === 0 &&
        year.stipendCents === 0 &&
        deposits.length > 0 &&
        found.input.transactions.every((t) => t.date >= thisYear) &&
        deposits.every((t) => t.pfc === "INCOME_SALARY" || t.pfc === "INCOME_WAGES"),
    },
    cash: {
      places: cash.places.map(({ name, kind, balanceCents, today }) => ({
        name,
        kind,
        balanceCents,
        today: today ?? null,
      })),
    },
    funds,
    // The insurers the stored rows show as premiums, and the merchants with a policy row
    // (class 10, ./invariants.ts premiumsOnFile). Read where the data ends, as the schedule above
    // is, so it doesn't move with the calendar over data held still (gate C).
    insurance: {
      premiums: ((asOfData) => policiesFromStreams(asOfData, buildStreams(asOfData)))({
        ...input,
        asOf: input.transactions.reduce((a, t) => (t.date > a ? t.date : a), "") || input.asOf,
      })
        .map((f) => f.merchantKey)
        .sort(),
      onFile: (
        await scopedFor(userId, client).insurancePolicies.findMany({
          where: { merchantKey: { not: null } },
          select: { merchantKey: true },
          // In one order, so two copies of a person read the same (./same-twice.ts).
          orderBy: { merchantKey: "asc" },
        })
      ).map((p) => p.merchantKey),
    },
  });
}

// What the person's data has, for words that name a source or a thing (./claimed-sources.ts): a
// linked bank or broker (a figure "they report"), uploaded statements, a card, each kind of loan
// (an account, a lender's report or its payments seen), a 401(k), a policy, a pay stub. The
// employer is the profile's (profile.facts.employer).
async function onFileOf(
  userId: string,
  client: PrismaClient,
  transactions: readonly { pfcDetailed: string | null; amountCents: number }[],
) {
  const db = scopedFor(userId, client);
  const [accounts, liabilities, policies, documents] = await Promise.all([
    db.accounts.findMany({ select: { source: true, type: true, subtype: true } }),
    db.liabilities.findMany({ select: { kind: true } }),
    db.insurancePolicies.count(),
    db.documents.findMany({ select: { kind: true } }),
  ]);
  const linked = (a: { source: string }) => a.source !== "csv";
  const paid = (pfc: string) =>
    transactions.some((t) => t.amountCents > 0 && t.pfcDetailed === pfc);
  const loans = new Set<string>();
  for (const a of accounts) {
    if (a.type === "loan" || a.type === "mortgage") loans.add(loanKind(a.subtype ?? a.type));
  }
  for (const l of liabilities) if (l.kind !== "credit") loans.add(loanKind(l.kind));
  if (paid("LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT")) loans.add("student");
  if (paid("LOAN_PAYMENTS_CAR_PAYMENT")) loans.add("auto");
  if (paid("LOAN_PAYMENTS_MORTGAGE_PAYMENT")) loans.add("mortgage");
  return {
    linkedBank: accounts.some((a) => linked(a) && a.type !== "investment"),
    linkedInvestments: accounts.some((a) => linked(a) && a.type === "investment"),
    statements: accounts.some((a) => a.source === "csv"),
    card: accounts.some((a) => a.type === "credit") || paid("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"),
    loans: [...loans].sort(),
    retirement401k: accounts.some((a) => a.subtype === "401k"),
    policies: policies > 0,
    payStub: documents.some((d) => /pay ?stub|paystub/i.test(d.kind)),
  };
}

const loanKind = (kind: string) =>
  /student/i.test(kind)
    ? "student"
    : /auto|car|vehicle/i.test(kind)
      ? "auto"
      : /mortgage|home/i.test(kind)
        ? "mortgage"
        : "other";

import { DECISION_HIGH_RATE_BPS, DECISION_MIN_CUSHION_MONTHS } from "@/config/agent-chat";
import type { PrismaClient } from "@/generated/prisma/client";
import { liquidCents, monthlySpendCents } from "@/detectors/helpers";
import { adviceMode } from "@/lib/advice-mode";
import { formatCents } from "@/lib/money";
import { loadProfileInput } from "@/lib/profile";
import { listGoals } from "@/lib/goals";
import { emergencyTarget } from "@/planning/emergency-fund";
import { buildProfile } from "@/profile/build";
import type { CoreSubject, DecisionIntent, DecisionItem } from "./decision-intents";
import type { Topic } from "./context";
import type { Reply } from "./replies";
import type { MessageAction } from "./types";

// A decision question ("should I buy bitcoin?") answered from the person's own numbers: what
// they owe and at what rate, whether their cash cushion is built, and the goals still short.
// The thing itself (a coin, a house) is only a follow-up. In demo advice mode Jane says what
// she'd do first; on a real account she gives the facts and no recommendation (REAL_ACCOUNT_
// ADVICE stays off). Never a prediction of what the thing will do.

export type DecisionFacts = {
  cardDebtCents: number;
  // The highest rate on a credit card or loan, in basis points a year, when known.
  topRateBps: number | null;
  cashCents: number;
  monthlySpendCents: number;
  cushionTargetCents: number | null;
  cushionMonths: number | null;
  goalsBehind: { name: string; leftCents: number }[];
};

type Options = { client: PrismaClient; now: Date };

export async function loadDecisionFacts(
  userId: string,
  { client, now }: Options,
): Promise<DecisionFacts> {
  const data = await loadProfileInput(userId, { client, now });
  const profile = buildProfile(data);
  const spend = monthlySpendCents(data, profile.months);
  const cash = liquidCents(data);
  const income = profile.facts.monthly_income;
  const pattern = profile.facts.income_pattern;
  const target = emergencyTarget({
    spendingCents: spend,
    incomeCents: typeof income.value === "number" ? income.value : null,
    pattern: typeof pattern.value === "string" ? pattern.value : null,
    debtTrouble: profile.facts.debt_trouble.value === true,
  });
  const card = profile.facts.card_debt_cents.value;
  const rates = data.liabilities
    .filter((l) => l.kind !== "mortgage" && l.aprBps !== null)
    .map((l) => l.aprBps as number);
  const goals = await listGoals(userId, { client, now });
  return {
    cardDebtCents: typeof card === "number" ? card : 0,
    topRateBps: rates.length > 0 ? Math.max(...rates) : null,
    cashCents: cash,
    monthlySpendCents: spend,
    cushionTargetCents: target?.targetCents ?? null,
    cushionMonths: spend > 0 ? Math.round((cash / spend) * 10) / 10 : null,
    goalsBehind: goals
      .filter((g) => g.progress.status !== "reached" && g.targetCents > g.progress.savedCents)
      .map((g) => ({ name: g.name, leftCents: g.targetCents - g.progress.savedCents }))
      .slice(0, 2),
  };
}

const link = (label: string, href: string): MessageAction => ({
  id: "open",
  label,
  kind: "link",
  href,
});

const THING: Record<CoreSubject, string> = {
  crypto: "crypto",
  stocks: "stocks",
  invest: "investing",
  home: "a home",
  car: "a car",
  payoff_or_invest: "paying off debt or investing",
  other: "that",
};

const rate = (bps: number) => `${Math.round(bps / 10) / 10}%`;

// Where they stand, in their figures, one sentence each.
function standing(f: DecisionFacts): string[] {
  const lines: string[] = [];
  if (f.cardDebtCents > 0) {
    lines.push(
      `You owe ${formatCents(f.cardDebtCents)} on credit cards${f.topRateBps ? `, at up to ${rate(f.topRateBps)} a year` : ""}.`,
    );
  } else {
    lines.push("You have no credit card debt.");
  }
  if (f.cushionTargetCents !== null) {
    lines.push(
      `You hold ${formatCents(f.cashCents)} in cash${f.cushionMonths !== null ? `, about ${f.cushionMonths} months of spending` : ""}; a cushion for you is ${formatCents(f.cushionTargetCents)}.`,
    );
  } else {
    lines.push(`You hold ${formatCents(f.cashCents)} in cash.`);
  }
  for (const g of f.goalsBehind) {
    lines.push(`Your goal "${g.name}" still has ${formatCents(g.leftCents)} to go.`);
  }
  return lines;
}

// What comes first, if anything, from the same numbers. Null when the basics are covered.
function first(f: DecisionFacts): { say: string; link: MessageAction } | null {
  if (f.cardDebtCents > 0 && (f.topRateBps ?? 0) >= DECISION_HIGH_RATE_BPS) {
    // Cash that covers the cards and still leaves the cushion: clear them today.
    const left = f.cashCents - f.cardDebtCents;
    if (left >= (f.cushionTargetCents ?? 0)) {
      return {
        say: `I'd clear the cards first: your cash covers the ${formatCents(f.cardDebtCents)} and still leaves ${formatCents(left)}, and they cost you up to ${rate(f.topRateBps as number)} a year, which no investment reliably beats.`,
        link: link("See my card payoff options", "/debt"),
      };
    }
    return {
      say: `I'd pay the cards down first: every dollar on them saves you their ${rate(f.topRateBps as number)} a year, which no investment reliably beats.`,
      link: link("See my card payoff options", "/debt"),
    };
  }
  if (
    f.cushionTargetCents !== null &&
    f.cashCents < f.cushionTargetCents &&
    (f.cushionMonths ?? 0) < DECISION_MIN_CUSHION_MONTHS + 6
  ) {
    return {
      say: `I'd build your cushion to ${formatCents(f.cushionTargetCents)} first, so a surprise doesn't land on a card.`,
      link: link("See my goals", "/goals"),
    };
  }
  return null;
}

const CLOSING: Record<DecisionItem, string> = {
  crypto:
    "If you still want some after that, keep it a small slice of what you invest, an amount you could lose entirely: crypto swings a lot, and I can't tell you where it goes.",
  stocks:
    "After that, a broad index fund is the usual place to start. I can't tell you where any one stock is going.",
  invest:
    "After that, your workplace plan's match comes before anything else, then a broad index fund.",
  home: "A home also needs a down payment, closing costs and a repair cushion on top of the monthly payment. I can check what a payment would do to your month.",
  car: "A car also brings insurance, fuel and repairs on top of the payment. I can check what a payment would do to your month.",
  payoff_or_invest:
    "If there's an employer match, take it first; after that, a debt above about 8% a year is a better 'return' than most investments.",
  other: "I can check what it would do to your month if you tell me the price.",
};

// "How much should I have in an emergency fund?": what a cushion is for them, in their figures.
function cushionReply(f: DecisionFacts, advice: boolean): Reply {
  const body =
    f.cushionTargetCents === null
      ? "I need to see a few months of your spending to size a cushion. Once your bank is linked, I'll tell you."
      : [
          `A cushion for you is ${formatCents(f.cushionTargetCents)}${f.monthlySpendCents > 0 ? `: you spend about ${formatCents(f.monthlySpendCents)} a month` : ""}.`,
          `You hold ${formatCents(f.cashCents)} in cash${f.cushionMonths !== null ? `, about ${f.cushionMonths} months of spending` : ""}.`,
          f.cashCents >= f.cushionTargetCents
            ? "That covers it."
            : `You are ${formatCents(f.cushionTargetCents - f.cashCents)} short of it.`,
          advice && f.cardDebtCents > 0
            ? "A card balance at a high rate usually comes first, then the rest of the cushion."
            : "",
        ]
          .filter(Boolean)
          .join(" ");
  return {
    body,
    actions: [link("See my goals", "/goals")],
    refs: {
      topic: { kind: "decision", category: "cushion", target: "an emergency fund" },
      ...(advice ? { advice: true as const } : {}),
    },
  };
}

export function decisionReply(
  intent: DecisionIntent,
  topic: Topic | null,
  facts: DecisionFacts,
  advice: boolean,
): Reply {
  // "Should I buy?" on its own is about what was just discussed.
  const fromTopic = topic?.kind === "decision" ? topic : null;
  const item = intent.item ?? (fromTopic?.category as DecisionItem | undefined) ?? null;
  if (!item) {
    return {
      body: "Buy what? Tell me what you're thinking of (bitcoin, some stocks, a house, a car) and I'll check it against your debts, your cash cushion and your goals.",
      actions: [],
      refs: {},
    };
  }
  const label = intent.label ?? fromTopic?.target ?? THING[item as CoreSubject] ?? THING.other;
  if (item === "cushion") return cushionReply(facts, advice);
  const lines = standing(facts);
  const lead = first(facts);
  const body = advice
    ? intent.why && lead
      ? `${lead.say} Ask me about ${label} again once that's done.`
      : [
          `Before ${label}, here is where you stand.`,
          ...lines,
          lead
            ? `${lead.say} ${CLOSING[item as CoreSubject] ?? CLOSING.other}`
            : `Your basics look covered, so putting some toward ${label} is reasonable. ${CLOSING[item as CoreSubject] ?? CLOSING.other}`,
        ].join(" ")
    : [
        `Here is where you stand on the things that matter before ${label}.`,
        ...lines,
        "I can show you the facts, but I don't give advice on what to buy with your real accounts.",
      ].join(" ");
  const actions: MessageAction[] = [];
  if (advice && lead) actions.push(lead.link);
  if (item === "crypto") actions.push(link("See crypto", "/investments/crypto"));
  if (item === "home" || item === "car" || item === "other")
    actions.push(link("Can I afford it?", "/afford"));
  if (actions.length === 0) actions.push(link("See my goals", "/goals"));
  return {
    body,
    actions,
    refs: {
      topic: { kind: "decision", category: item, target: label },
      ...(advice ? { advice: true as const } : {}),
    },
  };
}

// What a sector's decide() returns (docs/decisions.md): a short answer built from the
// person's own figures. The router adds the confidence line, the topic (so "should I buy?"
// afterwards is about this) and, in demo advice mode, the label.
export type Decision = {
  body: string;
  actions: MessageAction[];
  // How sure Jane is, with the evidence, shown as "85% sure: 12 months of balances."
  confidence?: { percent: number; reason: string };
  refs?: Reply["refs"];
};

// What a sector's decide() is given.
export type DecideContext = {
  userId: string;
  client: PrismaClient;
  now: Date;
  item: DecisionItem;
  // What they called it, for the answer's words ("bitcoin", "life insurance").
  label: string;
  // The general facts every decision starts from (card debt, cushion, goals).
  facts: DecisionFacts;
  // Demo advice mode: recommendations allowed, labelled. Off on real accounts: facts only.
  advice: boolean;
};

// The sector that claims a subject (Capability.decides), if any.
export type Decider = {
  decides?: readonly DecisionItem[];
  decide?: (context: DecideContext) => Promise<Decision | null>;
};

// The one router for "should I ...?": the sector whose subject it is answers it (its decide),
// and any subject nobody claims, or a sector that declines, gets the general answer from the
// person's debts, cushion and goals.
export async function answerDecision(
  userId: string,
  intent: DecisionIntent,
  topic: Topic | null,
  { client, now, sectors = [] }: Options & { sectors?: readonly Decider[] },
): Promise<Reply> {
  const [facts, advice] = await Promise.all([
    loadDecisionFacts(userId, { client, now }),
    adviceMode(userId, { client }),
  ]);
  const item =
    intent.item ?? (topic?.kind === "decision" ? (topic.category as DecisionItem) : null);
  const sector = item ? sectors.find((s) => s.decide && s.decides?.includes(item)) : undefined;
  if (item && sector?.decide) {
    const label = intent.label ?? topic?.target ?? String(THING[item as CoreSubject] ?? "that");
    const made = await sector.decide({ userId, client, now, item, label, facts, advice });
    if (made) {
      const sure = made.confidence
        ? `\n${made.confidence.percent}% sure: ${made.confidence.reason}.`
        : "";
      return {
        body: `${made.body}${sure}`,
        actions: made.actions,
        refs: {
          ...made.refs,
          topic: { kind: "decision", category: item, target: label },
          ...(advice ? { advice: true as const } : {}),
        },
      };
    }
  }
  return decisionReply(intent, topic, facts, advice);
}

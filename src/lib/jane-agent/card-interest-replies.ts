import { dayLabel } from "@/lib/day-label";
import type { CardInterest } from "@/lib/card-interest";
import { formatCents } from "@/lib/money";
import { promoLine } from "@/planning/card-interest";
import type { Reply } from "./replies";
import { type MessageAction, openLink } from "./types";
import { formatRate } from "@/lib/percent";

// Jane's answers about card interest (spec step 224), from src/lib/card-interest.ts. Pure.
// Demo advice, labelled; a request for a lower rate is sent only on a tap.

export const INTEREST_PAGE: MessageAction = openLink("Cut your card interest", "/loans/interest");

export const askButton = (card: string): MessageAction => ({
  id: "cardrate.send",
  label: `Ask ${card} for a lower rate`,
  kind: "primary",
});

export function firstAsk(data: CardInterest) {
  return data.cards.find((c) => c.rate && !c.rate.sent) ?? null;
}

// The card interest Jane found in the person's transactions: its finding (the title says what was
// paid, on which card and over how long: "$84.81 in interest on Chase card in the last 3 months")
// and what that comes to a year.
export type InterestSeen = { findingId: string; title: string; yearlyCents: number | null };

// Without a lending partner (every real account) there are no rate requests or promotions to
// track, but the interest is still in the transactions (debugger 11-16: "how much interest am I
// paying on my credit card?" got "Cutting card interest needs a lending partner" from someone who
// had paid $84.81 in three months). The answer is what was paid, and the finding's own steps.
// Interest a lender reports paid this year on a loan, by the loan's name (a linked bank's).
export type LoanInterest = { name: string; ytdCents: number };

// "How much did I pay in interest?" is more than cards: the year's interest each lender reports is
// said too (debug 2, 11-17: "I don't see any card interest in your accounts" to someone whose
// student loan lender reported $3,119.50 paid this year).
const loansLine = (loans: readonly LoanInterest[]) => {
  const paid = loans.filter((l) => l.ytdCents > 0);
  if (paid.length === 0) return "";
  const each = paid.map((l) => `${formatCents(l.ytdCents)} on ${l.name}`);
  return ` Your ${paid.length === 1 ? "lender reports" : "lenders report"} ${
    each.length === 1 ? each[0] : `${each.slice(0, -1).join(", ")} and ${each.at(-1)}`
  } in interest paid this year.`;
};

export function cardInterestReply(
  data: CardInterest,
  seen: InterestSeen | null = null,
  loans: readonly LoanInterest[] = [],
): Reply {
  if (!data.available) {
    if (!seen) {
      return {
        body: `I don't see any card interest in your accounts. Paying each card in full every month keeps it that way.${loansLine(loans)}`,
        actions: [],
        refs: {},
      };
    }
    // A year of interest seen is already the year's figure: said once (debug 2, 11-15: "$353.31 in
    // interest on Capital One card in the last 12 months, about $353.31 a year").
    const yearly =
      seen.yearlyCents === null || seen.title.includes(formatCents(seen.yearlyCents))
        ? ""
        : `, about ${formatCents(seen.yearlyCents)} a year`;
    return {
      body: `You paid ${seen.title}${yearly}. Paying the balance off ends it; until then, asking the card company for a lower rate cuts it.${loansLine(loans)}`,
      actions: [openLink("Show me how", `/report/${seen.findingId}`)],
      refs: {},
    };
  }
  if (data.cards.length === 0 && data.promos.length === 0) {
    return {
      body: "None of your cards carries a balance charged interest, so there's no card interest to cut. Paying in full each month keeps it that way.",
      actions: [INTEREST_PAGE],
      refs: {},
    };
  }
  const lines: string[] = [];
  if (data.cards.length > 0) {
    lines.push(
      `Your cards cost about ${formatCents(data.interestYearCents)} a year in interest at today's balances.`,
    );
    for (const c of data.cards) {
      const bits = [`${formatCents(c.balanceCents)} at ${formatRate(c.aprBps)}`];
      if (c.payEarly) {
        bits.push(
          `paying the ${formatCents(c.payEarly.amountCents)} now, not on the due date, saves ${formatCents(c.payEarly.savedCents)}`,
        );
      }
      if (c.statementClosesOn) bits.push(`statement closes ${dayLabel(c.statementClosesOn)}`);
      lines.push(`- ${c.name}: ${bits.join("; ")}`);
    }
  }
  for (const p of data.promos) {
    lines.push(
      p.plan.onPace
        ? `- ${promoLine(p.cardName, p.plan, p.endsOn)} You're on pace.`
        : `- ${promoLine(p.cardName, p.plan, p.endsOn)} You're ${formatCents(p.plan.shortCents)} a month short${p.deferred ? `, and missing it would charge about ${formatCents(p.plan.costIfMissedCents)} in deferred interest` : ""}.`,
    );
  }
  const next = firstAsk(data);
  if (next?.rate) {
    lines.push(
      `Asking ${next.name} for a lower rate could save about ${formatCents(next.rate.savingYearlyCents)} a year. I've written the request and a call script; nothing is sent until you tap.`,
    );
  } else if (data.grantedSavingCents > 0) {
    lines.push(`Rate cuts you've won save about ${formatCents(data.grantedSavingCents)} a year.`);
  }
  return {
    body: lines.join("\n"),
    actions: next ? [askButton(next.name), INTEREST_PAGE] : [INTEREST_PAGE],
    refs: next?.rate ? { advice: true, cardRate: { id: next.rate.id } } : { advice: true },
  };
}

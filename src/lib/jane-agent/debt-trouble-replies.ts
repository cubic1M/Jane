import { TROUBLE_DEBT_MONTHS } from "@/config/profile";
import {
  COUNSELOR_REFERRALS,
  COUNSEL_POINTER,
  DEBT_FACTS,
  DMP_NOTE,
  FACTS_HEADING,
  HARDSHIP_PROGRAMS,
  TROUBLE_PAYMENT_SHARE,
} from "@/config/debt-trouble";
import type { DebtTrouble } from "@/lib/debt-trouble";
import { formatCents } from "@/lib/money";
import type { Reply } from "./replies";
import type { MessageAction } from "./types";

// Jane's answers when debt is too much (spec step 229), from src/lib/debt-trouble.ts. Pure.
// Facts and doors to knock on: she doesn't choose between them, never advises on settlement
// or bankruptcy, and sends nothing. The fact sentences are the reviewed ones in
// src/config/debt-trouble.ts, word for word.

export const TROUBLE_PAGE: MessageAction = {
  id: "open",
  label: "Your options in full",
  kind: "link",
  href: "/loans/help",
};

const pct = (share: number) => `${Math.round(share * 100)}%`;
const SHOWN_DEBTS = 5;

export function headline(data: DebtTrouble): string {
  const pay = formatCents(data.monthlyPaymentsCents);
  if (data.share === null || data.incomeCents === null) {
    return `Your debt payments are ${pay} a month, and I can't see your income yet to compare them.`;
  }
  if (data.reason === "payday_cycle") {
    return `You've been repaying cash advances, a cycle that's hard to get out of, alongside ${pay} a month of debt payments (${pct(data.share)} of your ${formatCents(data.incomeCents)} income). It's worth looking at your options.`;
  }
  if (data.reason === "card_debt") {
    return `Your cards hold ${formatCents(data.cardDebtCents)}, more than ${TROUBLE_DEBT_MONTHS} months of your ${formatCents(data.incomeCents)} income, and your debt payments are ${pay} a month. It's worth looking at your options.`;
  }
  return data.over
    ? `Your debt payments are ${pay} a month, ${pct(data.share)} of your ${formatCents(data.incomeCents)} income, which is over the ${pct(TROUBLE_PAYMENT_SHARE)} mark where it's worth looking at your options.`
    : `Your debt payments are ${pay} a month, ${pct(data.share)} of your ${formatCents(data.incomeCents)} income, under the ${pct(TROUBLE_PAYMENT_SHARE)} mark where I'd bring this up myself, but the options are here if you want them.`;
}

export function hardshipLines(data: DebtTrouble): string[] {
  return data.debts
    .slice(0, SHOWN_DEBTS)
    .map(
      (d) => `- ${d.name} (${formatCents(d.balanceCents ?? 0)}): ${HARDSHIP_PROGRAMS[d.kind].ask}`,
    );
}

export function dmpLines(data: DebtTrouble): string[] {
  const lines = [DMP_NOTE];
  const d = data.dmp;
  if (d) {
    lines.push(
      `At about ${d.assumedAprBps / 100}% (a typical rate a counselor asks for, not an offer), your card payments of ${formatCents(d.cardPaymentCents)} a month would clear ${formatCents(d.cardBalanceCents)} in about ${d.monthsAssumed} months${d.monthsNow !== null ? `, against ${d.monthsNow} at today's rates` : ""}${d.interestCutCents > 0 ? `, and cut interest by about ${formatCents(d.interestCutCents)}` : ""}.`,
    );
  }
  lines.push(
    `Nonprofit counselors: ${COUNSELOR_REFERRALS.map((c) => `${c.name} (${c.url.replace("https://", "").replace(/\/$/, "")})`).join(", ")}.`,
  );
  return lines;
}

export function debtTroubleReply(data: DebtTrouble): Reply {
  if (!data.available) {
    return {
      body: "I don't see a debt with a balance, so there's nothing to be in trouble over. If something is missing, link the account or add the debt on your loans page.",
      actions: [],
      refs: {},
    };
  }
  const lines = [
    headline(data),
    "Hardship programs, by lender:",
    ...hardshipLines(data),
    "",
    ...dmpLines(data),
    "",
    FACTS_HEADING,
    ...[...DEBT_FACTS.settlement, ...DEBT_FACTS.bankruptcy, ...DEBT_FACTS.taxes].map(
      (f) => `- ${f.text}`,
    ),
    COUNSEL_POINTER,
  ];
  return { body: lines.join("\n"), actions: [TROUBLE_PAGE], refs: {} };
}

import { STATEMENT_CUSHION_CENTS } from "@/config/credit-building";
import type { CreditBuilding } from "@/lib/credit-building";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import { CREDIT_PAGE } from "./credit-replies";
import type { Reply } from "./replies";
import type { MessageAction, MessageRefs } from "./types";

// Jane's answers about building credit (spec step 175), from src/lib/credit-building.ts.
// Pure. The simulator's figures are always called estimates.

export const ESTIMATE_LABEL =
  "These are estimates from the stand-in score's simulator, not promises: nothing changes until you act.";

const months = (n: number) => `${n} ${n === 1 ? "month" : "months"}`;
const signed = (n: number) =>
  n > 0 ? `up about ${n}` : n < 0 ? `down about ${-n}` : "about the same";

export function payButton(): MessageAction {
  return { id: "credit_build.pay", label: "Pay it before the statement", kind: "primary" };
}

export const builderButton = (name: string): MessageAction => ({
  id: "credit_builder.open",
  label: `Open the ${name}`,
  kind: "primary",
});

// What to pay before the statement closes, and why.
export function statementLine(data: CreditBuilding): string | null {
  const s = data.statement;
  if (!s) return null;
  if (s.scheduled) {
    return `${formatCents(s.scheduled.amountCents)} goes to your ${s.cardName} on ${dayLabel(s.scheduled.runOn)}, before its statement closes on ${dayLabel(s.closesOn)}, so a lower balance is reported.`;
  }
  if (!s.suggested) {
    return s.toUnderHighCents > 0
      ? `Your ${s.cardName}'s statement closes on ${dayLabel(s.closesOn)}. Paying ${formatCents(s.toUnderHighCents)} before then would bring card use under 30%, but checking can't spare it and keep ${formatCents(STATEMENT_CUSHION_CENTS)}.`
      : null;
  }
  const under = s.suggested.target === "good" ? "10%" : "30%";
  return `Pay ${formatCents(s.suggested.amountCents)} on your ${s.cardName} by ${dayLabel(s.payOn)}, before its statement closes on ${dayLabel(s.closesOn)}. Then the balance reported to the bureaus is under ${under} of your limits, which helps your score.`;
}

export function streakLine(data: CreditBuilding): string | null {
  const st = data.streak;
  if (!st) return null;
  if (st.months === 0) {
    return st.clean ? null : "Your on-time streak starts again from your last late payment.";
  }
  return st.clean
    ? `Every payment on time for ${months(st.months)}: everything I can see.`
    : `Every payment on time for ${months(st.months)}, since the late fee on ${dayLabel(st.since, { year: true })}.`;
}

export function buildCreditReply(data: CreditBuilding): Reply {
  if (!data.available) {
    return {
      body: "Building credit needs a credit partner, and there isn't one for your accounts yet. Nothing changes until there is.",
      actions: [],
      refs: {},
    };
  }
  const lines: string[] = [];
  const pay = statementLine(data);
  if (pay) lines.push(pay);
  const streak = streakLine(data);
  if (streak) lines.push(streak);
  const best = [...data.estimates].sort((a, b) => b.change - a.change)[0];
  if (data.score !== null && best && best.change > 0) {
    lines.push(
      `The biggest step from your score of ${data.score}: ${best.label.toLowerCase()}, ${signed(best.change)} points (an estimate).`,
    );
  }
  if (data.thin && data.builders[0]) {
    lines.push(
      `Your file is thin, so a credit-builder account helps: the ${data.builders[0].name}. ${data.builders[0].summary}`,
    );
  }
  if (lines.length === 0) {
    lines.push("Your card use is low and your payments are on time: keep doing just that.");
  }
  const refs: MessageRefs = { advice: true };
  const actions: MessageAction[] = [];
  const s = data.statement;
  if (s && !s.scheduled && s.suggested && s.canPay) {
    actions.push(payButton());
    refs.creditStatement = { accountId: s.accountId, closesOn: s.closesOn };
  } else if (data.thin && data.builders[0]) {
    actions.push(builderButton(data.builders[0].name));
    refs.creditBuilder = { productId: data.builders[0].id };
  }
  actions.push(CREDIT_PAGE);
  return { body: lines.join("\n"), actions, refs };
}

// "What would my score be if I paid my card off?"
export function simulateReply(data: CreditBuilding): Reply {
  if (!data.available) return buildCreditReply(data);
  if (data.score === null || data.estimates.length === 0) {
    return {
      body: "I haven't checked your score yet, so there's nothing to estimate from. I'll do it with a soft pull, which never affects it.",
      actions: [CREDIT_PAGE],
      refs: {},
    };
  }
  const best = [...data.estimates].sort((a, b) => b.change - a.change)[0];
  return {
    body: [
      `${best.label} would take your score from ${data.score} to about ${best.score}, the biggest step by the simulator's estimate.`,
      "Each change, estimated:",
      ...data.estimates.map((e) => `- ${e.label}: ${e.score} (${signed(e.change)})`),
      ESTIMATE_LABEL,
    ].join("\n"),
    actions: [CREDIT_PAGE],
    refs: { advice: true },
  };
}

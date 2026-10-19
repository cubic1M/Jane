import type { Credit } from "@/lib/credit";
import type { Reply } from "./replies";
import type { MessageAction } from "./types";

// Jane's answers about the credit score (spec step 116). Pure. The stand-in score is
// always called that.

export const CREDIT_PAGE: MessageAction = {
  id: "open",
  label: "See your credit score",
  kind: "link",
  href: "/loans/credit",
};

export const STAND_IN_LABEL =
  "This is a stand-in score for the demo bank, not your real credit score.";

const IMPACT = { helping: "Helping", hurting: "Hurting", neutral: "Neither" } as const;

export function creditReply(credit: Credit): Reply {
  if (!credit.available) {
    return {
      body: "A credit score comes from a credit partner, and there isn't one for your accounts yet. Nothing is pulled until there is.",
      actions: [],
      refs: {},
    };
  }
  const latest = credit.latest;
  if (!latest) {
    return {
      body: "I haven't checked your score yet. I'll do it with a soft pull, which never affects it.",
      actions: [CREDIT_PAGE],
      refs: {},
    };
  }
  const moved =
    credit.previousScore === null
      ? ""
      : latest.score === credit.previousScore
        ? ", the same as last month"
        : `, ${latest.score > credit.previousScore ? "up" : "down"} ${Math.abs(latest.score - credit.previousScore)} since last month`;
  const lines = [
    `Your score is ${latest.score} (${latest.range.low}–${latest.range.high})${moved}.${latest.demo ? ` ${STAND_IN_LABEL}` : ""}`,
    ...latest.factors.map((f) => `- ${IMPACT[f.impact]}: ${f.label}. ${f.detail}`),
    "What I'm doing about it:",
    ...latest.doing.map((d) => `- ${d}`),
  ];
  return { body: lines.join("\n"), actions: [CREDIT_PAGE], refs: {} };
}

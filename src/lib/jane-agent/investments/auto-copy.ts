import { SAFE_TO_SPEND_FLOOR_CENTS } from "@/config/auto-invest";
import { formatCents } from "@/lib/money";
import type { MessageAction } from "../types";

// Jane's words and buttons for automatic investing (spec step 134). Pure.

export const AUTO_PROMISE = `I'll only invest what safe to spend doesn't need (I keep at least ${formatCents(SAFE_TO_SPEND_FLOOR_CENTS)} of it), and pause a payday by myself when it's low.`;

export const startButtons = (amountCents: number): MessageAction[] => [
  {
    id: "invest.auto_start",
    label: `Start: ${formatCents(amountCents)} every payday`,
    kind: "primary",
  },
  { id: "invest.auto_leftover", label: "The rest after bills and goals", kind: "secondary" },
];

export const pauseButton = (): MessageAction => ({
  id: "invest.auto_pause",
  label: "Pause automatic investing",
  kind: "secondary",
});
export const resumeButton = (): MessageAction => ({
  id: "invest.auto_resume",
  label: "Turn it back on",
  kind: "primary",
});
export const AUTO_LINK: MessageAction = {
  id: "open",
  label: "See every payday",
  kind: "link",
  href: "/investments/auto",
};

export function runLine(run: {
  status: string;
  amountCents: number;
  paydayOn: string;
  reason: string | null;
}): string {
  const day = new Date(`${run.paydayOn}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return run.status === "invested"
    ? `I invested ${formatCents(run.amountCents)} from your ${day} paycheck, in the simulated brokerage (no real money moved).`
    : `I paused investing for your ${day} paycheck. ${run.reason ?? ""}`.trim();
}

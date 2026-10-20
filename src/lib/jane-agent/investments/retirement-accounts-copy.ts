import { formatCents } from "@/lib/money";
import type { RetirementAccountsView } from "@/lib/investments/retirement-accounts";
import type { MessageAction } from "../types";

// Retirement accounts used fully in the chat (spec step 210): shared words and buttons.

export const RA_LINK: MessageAction = {
  id: "open",
  label: "See your limits",
  kind: "link",
  href: "/investments/retirement-accounts",
};

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
type View = Pick<
  RetirementAccountsView,
  "match" | "limits" | "roth" | "ira" | "iraAllowedCents" | "pending"
>;

export const raMatchLine = (v: View) =>
  v.match && v.match.missedCents > 0
    ? `You're putting in about ${pct(v.match.employeeRate)} of pay and your employer matches up to ${pct(v.match.fullMatchRate)}: you're leaving about ${formatCents(v.match.missedCents)} a year of their money on the table. Raising to ${pct(v.match.fullMatchRate)} of pay (about ${formatCents(v.match.extraEmployeeCents)} more a year from you) gets all of it.`
    : null;

export const limitsLine = (v: View) =>
  v.limits
    .map(
      (l) =>
        `${l.label}: ${formatCents(l.usedCents)} of ${formatCents(l.limitCents)} (${formatCents(l.roomCents)} left)`,
    )
    .join("; ");

export const rothLine = (v: View) => {
  const a = v.roth.access;
  if (a?.kind === "backdoor")
    return `Your income is over the Roth IRA limit, so it can't be funded directly. The backdoor route: ${a.steps.join(" ")} ${a.note} I don't do this one for you.`;
  const choice =
    v.roth.choice === "roth"
      ? "Roth usually wins at your bracket (pay the tax now)."
      : v.roth.choice === "traditional"
        ? "Traditional usually wins at your bracket (the deduction now)."
        : v.roth.choice === "mix"
          ? "A mix of Roth and traditional suits your bracket."
          : "";
  return `${choice} ${a?.kind === "partial" ? `You're in the Roth IRA phase-out: about ${pct(a.allowedShare)} of the limit can go in directly.` : ""}`.trim();
};

export const matchButton = (v: View): MessageAction | null =>
  v.match && v.match.missedCents > 0 && !v.pending
    ? {
        id: "retire.match",
        label: `Raise to ${pct(v.match.fullMatchRate)} of pay`,
        kind: "primary",
      }
    : null;

export const iraButton = (v: View): MessageAction | null =>
  v.ira && v.iraAllowedCents > 0 && v.roth.access?.kind !== "backdoor"
    ? {
        id: "retire.ira",
        label: `Put ${formatCents(v.iraAllowedCents)} in my IRA`,
        kind: "primary",
      }
    : null;

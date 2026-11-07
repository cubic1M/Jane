import { PAYSTUB_DEDUCTIONS, STATE_AUTO_IRAS } from "@/config/retirement";

// A paystub's deduction lines, sorted (connectors roadmap round 17, paystub_deduction_parser): what
// goes into a workplace plan before tax, as Roth, back to a plan loan, or to a state auto-IRA, by
// the line's printed name. Feeds the match-gap arithmetic (./retirement-accounts.ts matchGap) and
// the auto-IRA and loan-offset facts. Names are read, never stored here. Pure.

export type DeductionKind = "pretax_plan" | "roth_plan" | "plan_loan" | "state_auto_ira" | "other";

export type SortedDeduction = { kind: DeductionKind; cents: number; programme?: string };

export function sortDeduction(name: string, cents: number): SortedDeduction {
  const auto = STATE_AUTO_IRAS.find((p) => p.match.test(name));
  if (auto) return { kind: "state_auto_ira", cents, programme: auto.name };
  if (PAYSTUB_DEDUCTIONS.loan.test(name)) return { kind: "plan_loan", cents };
  if (PAYSTUB_DEDUCTIONS.roth.test(name)) return { kind: "roth_plan", cents };
  if (PAYSTUB_DEDUCTIONS.pretax.test(name)) return { kind: "pretax_plan", cents };
  return { kind: "other", cents };
}

// One paystub: what the person put into retirement saving, as a share of gross pay (a loan
// repayment isn't saving), and which state programme, if any.
export function paystubSaving(stub: {
  grossCents: number;
  deductions: readonly { name: string; cents: number }[];
}) {
  const sorted = stub.deductions.map((d) => sortDeduction(d.name, Math.abs(d.cents)));
  const sum = (kinds: DeductionKind[]) =>
    sorted.filter((d) => kinds.includes(d.kind)).reduce((s, d) => s + d.cents, 0);
  const savedCents = sum(["pretax_plan", "roth_plan", "state_auto_ira"]);
  return {
    sorted,
    savedCents,
    planCents: sum(["pretax_plan", "roth_plan"]),
    loanCents: sum(["plan_loan"]),
    rate: stub.grossCents > 0 ? savedCents / stub.grossCents : 0,
    programme: sorted.find((d) => d.kind === "state_auto_ira")?.programme ?? null,
  };
}

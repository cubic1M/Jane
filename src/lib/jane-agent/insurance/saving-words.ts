import { POLICY_KINDS } from "@/config/insurance";
import { lowersCover } from "@/lib/insurance/saving-rules";
import type { Saving } from "@/lib/insurance/savings";
import type { Policy } from "@/lib/insurance/policies";
import { formatCents } from "@/lib/money";
import type { MessageAction } from "../types";

// Paying less for the same cover in Jane's chat (spec step 196): the savings that keep the
// cover as it is, together in one message with one tap; a higher deductible, which lowers
// the cover, on its own with what it costs on a claim. Pure.

type PolicyLike = Pick<Policy, "id" | "carrier" | "kind">;

const policyWords = (p: PolicyLike | undefined) =>
  p ? `${p.carrier} ${POLICY_KINDS[p.kind].toLowerCase()} policy` : "policy";

const perYear = (cents: number) => `about ${formatCents(cents)} a year`;

// Pure: one saving as a line, with its yearly figure and what changes.
export function savingLine(s: Saving, policy: PolicyLike | undefined): string {
  const p = policyWords(policy);
  switch (s.kind) {
    case "pay_in_full":
      return `Pay your ${p} once a year instead of in installments, ${formatCents(s.detail.payNowCents ?? 0)} up front: ${perYear(s.yearlySavingCents)} less`;
    case "autopay":
      return `Turn on autopay for your ${p}: ${perYear(s.yearlySavingCents)} less`;
    case "paperless":
      return `Switch your ${p} to paperless: ${perYear(s.yearlySavingCents)} less`;
    case "telematics":
      return `Join ${policy?.carrier ?? "your carrier"}'s safe-driver program on your car policy: ${perYear(s.yearlySavingCents)} less`;
    case "bundle":
      return `Put your car and your ${s.detail.withCarrier ?? "home"} policy with ${s.detail.withCarrier ?? "one carrier"}: ${perYear(s.yearlySavingCents)} less between them`;
    case "higher_deductible":
      return `Raise the deductible on your ${p} from ${formatCents(s.detail.fromDeductibleCents ?? 0)} to ${formatCents(s.detail.toDeductibleCents ?? 0)}: ${perYear(s.yearlySavingCents)} less`;
  }
}

export const sameCover = (savings: Saving[]) => savings.filter((s) => !lowersCover(s.kind));
export const lowering = (savings: Saving[]) => savings.filter((s) => lowersCover(s.kind));

// Pure: the savings that leave the cover as it is, in one message.
export function sameCoverBody(savings: Saving[], policies: PolicyLike[]): string {
  const byId = new Map(policies.map((p) => [p.id, p]));
  const total = savings.reduce((sum, s) => sum + s.yearlySavingCents, 0);
  return [
    `${savings.length === 1 ? "There's a way" : `There are ${savings.length} ways`} to pay less for the cover you already have.`,
    ...savings.map((s) => `- ${savingLine(s, byId.get(s.policyId))}`),
    // Percentage discounts stack on a shrinking price, so together they come to a little
    // less than each added up: "up to".
    savings.length === 1
      ? `That's ${perYear(total)}, and your cover stays exactly as it is.`
      : `Together that's up to ${perYear(total)} (they overlap a little), and your cover stays exactly as it is.`,
  ].join("\n");
}

export const sameCoverActions = (savings: Saving[]): MessageAction[] => [
  {
    id: "saving.apply_all",
    label: savings.length === 1 ? "Do it" : "Do all of these",
    kind: "primary",
  },
  { id: "open", label: "Your insurance", kind: "link", href: "/insurance?focus=savings" },
  { id: "saving.no", label: "Not now", kind: "secondary" },
];

// Pure: a higher deductible, both ways: the saving, and what it costs if they claim.
export function deductibleBody(s: Saving, policy: PolicyLike | undefined): string {
  const from = s.detail.fromDeductibleCents ?? 0;
  const to = s.detail.toDeductibleCents ?? 0;
  return [
    `Raising the deductible on your ${policyWords(policy)} from ${formatCents(from)} to ${formatCents(to)} would save ${perYear(s.yearlySavingCents)}.`,
    `The other side: if you claim, you'd pay ${formatCents(to - from)} more yourself. Your savings cover it, but this one lowers your cover, so it's your call.`,
  ].join("\n");
}

export const deductibleActions = (): MessageAction[] => [
  { id: "saving.apply", label: "Raise it", kind: "primary" },
  { id: "saving.no", label: "Keep it as it is", kind: "secondary" },
];

// Pure: what was done.
export function appliedNote(done: Saving[]): string {
  const total = done.reduce((sum, s) => sum + s.yearlySavingCents, 0);
  return `Done. That's ${perYear(total)} less${done.some((s) => lowersCover(s.kind)) ? ", with a higher deductible" : ", with the same cover"}.`;
}

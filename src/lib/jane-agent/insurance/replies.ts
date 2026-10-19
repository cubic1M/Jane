import { PREMIUM_FREQUENCIES } from "@/config/documents";
import { POLICY_KINDS, type PolicyKind } from "@/config/insurance";
import { daysBetween } from "@/detection/units";
import { checkGuardrails } from "@/lib/guardrails";
import { coverageLines } from "@/lib/insurance/coverage";
import { kindWords } from "@/lib/insurance/gaps";
import { yearlyPremium } from "@/lib/insurance/policies";
import { formatCents } from "@/lib/money";
import type { Reply } from "../replies";
import type { MessageAction } from "../types";
import type { InsuranceIntent } from "./intents";
import type { InsuranceSnapshot } from "./snapshot";

// Jane's answers about insurance (spec Phase X). Pure: the profile in, fixed wording out.
// Every figure comes from a policy record; when the record doesn't have it, Jane says so
// and offers to add it. No advice here: what to buy is demo advice (spec step 98).

type Policy = InsuranceSnapshot["policies"][number];

const link = (label: string, href: string): MessageAction => ({
  id: "open",
  label,
  kind: "link",
  href,
});
const SEE = link("See your insurance", "/insurance");
const editLink = (p: Policy) => link("Add the details", `/insurance?edit=${p.id}#policy-${p.id}`);
const addLink = (kind: PolicyKind | null) =>
  link("Add a policy", kind ? `/insurance?add=${kind}#add` : "/insurance#add");

const dateWords = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

// "your GEICO car insurance".
export const policyName = (p: Pick<Policy, "carrier" | "kind">) =>
  `your ${p.carrier} ${kindWords(p.kind)}`;
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function priceWords(p: Policy): string | null {
  if (p.premiumCents === null || !p.premiumFrequency) return null;
  const frequency = PREMIUM_FREQUENCIES[p.premiumFrequency];
  const yearly = yearlyPremium(p);
  return frequency.perYear > 1 && yearly !== null
    ? `${formatCents(p.premiumCents)} ${frequency.label} (${formatCents(yearly)} a year)`
    : `${formatCents(p.premiumCents)} ${frequency.label}`;
}

function renewWords(p: Policy, asOf: string): string | null {
  if (!p.nextRenewal) return null;
  const days = daysBetween(asOf, p.nextRenewal);
  return `${dateWords(p.nextRenewal)}${days === 0 ? ", today" : days === 1 ? ", tomorrow" : `, in ${days} days`}`;
}

function coverWords(p: Policy): string[] {
  const lines: string[] = [];
  if (p.covers && checkGuardrails(p.covers, [p.premiumCents ?? 0]).ok) lines.push(p.covers);
  lines.push(...coverageLines(p.kind, p.coverage));
  if (p.deductibleCents !== null) lines.push(`Deductible: ${formatCents(p.deductibleCents)}`);
  return lines;
}

const listLine = (p: Policy, asOf: string) => {
  const price = priceWords(p);
  const renews = renewWords(p, asOf);
  const status =
    p.status === "found"
      ? " (found from your payments, not confirmed yet)"
      : p.status === "pending"
        ? " (starting)"
        : "";
  return `- ${p.carrier} ${kindWords(p.kind)}${status}${price ? `: ${price}` : ""}${renews ? `, renews ${renews}` : ""}`;
};

function noPolicy(kind: PolicyKind | null, insurance: Pick<InsuranceSnapshot, "gaps">): Reply {
  const gap = kind ? insurance.gaps.find((g) => g.kind === kind && !g.policyId) : undefined;
  const what = kind
    ? `a ${POLICY_KINDS[kind].toLowerCase()} insurance policy`
    : "any insurance policies";
  return {
    body: `I don't have ${what} on file.${gap ? ` ${gap.why}` : ""} Add it, or upload the policy document and I'll read it, and I'll keep track of it for you.`,
    actions: [addLink(kind), link("Upload a document", "/documents")],
    refs: {},
  };
}

function about(
  p: Policy,
  intent: InsuranceIntent,
  asOf: string,
): { line: string; missing: boolean } {
  const name = capital(policyName(p));
  switch (intent.ask) {
    case "renew": {
      const renews = renewWords(p, asOf);
      return renews
        ? { line: `${name} renews on ${renews}.`, missing: false }
        : { line: `I don't have the renewal date for ${policyName(p)}.`, missing: true };
    }
    case "cost": {
      const price = priceWords(p);
      return price
        ? { line: `${name} costs ${price}.`, missing: false }
        : { line: `I don't have the price of ${policyName(p)}.`, missing: true };
    }
    case "deductible":
      return p.deductibleCents !== null
        ? { line: `${name} has a ${formatCents(p.deductibleCents)} deductible.`, missing: false }
        : { line: `I don't have the deductible for ${policyName(p)}.`, missing: true };
    default: {
      const lines = coverWords(p);
      return lines.length > 0
        ? { line: `${name}:\n${lines.map((l) => `- ${l}`).join("\n")}`, missing: false }
        : { line: `I don't have what ${policyName(p)} covers yet.`, missing: true };
    }
  }
}

export function insuranceReply(
  intent: InsuranceIntent,
  insurance: InsuranceSnapshot | undefined,
  asOf: string,
): Reply {
  const profile = insurance ?? { policies: [], gaps: [] };

  const all = profile.policies;

  if (intent.ask === "gaps") {
    if (profile.gaps.length === 0) {
      return {
        body:
          all.length === 0
            ? "I don't have any of your policies yet, so I can't check your cover. Add them, or tell me about your household, and I'll look for gaps."
            : "Nothing looks missing from the policies and household facts I have. If something's changed, like a new car or someone new depending on you, tell me on the insurance page.",
        actions: [SEE],
        refs: {},
      };
    }
    return {
      body: `${profile.gaps.length === 1 ? "One thing looks" : `${profile.gaps.length} things look`} missing from your cover:\n${profile.gaps.map((g) => `- ${g.title}. ${g.why}`).join("\n")}`,
      actions: [SEE],
      refs: {},
    };
  }

  const policies = intent.policyKind ? all.filter((p) => p.kind === intent.policyKind) : all;
  if (policies.length === 0) return noPolicy(intent.policyKind, profile);

  if (intent.ask === "list" && !intent.policyKind) {
    const gaps = profile.gaps.length;
    return {
      body: `You have ${policies.length === 1 ? "1 policy" : `${policies.length} policies`} on file:\n${policies.map((p) => listLine(p, asOf)).join("\n")}${gaps > 0 ? `\n${gaps === 1 ? "One thing looks" : `${gaps} things look`} missing from your cover: ask me "what am I missing?"` : ""}`,
      actions: [SEE],
      refs: {},
    };
  }

  const answers = policies.map((p) => ({
    p,
    ...about(p, { ...intent, ask: intent.ask === "list" ? "cover" : intent.ask }, asOf),
  }));
  const missing = answers.find((a) => a.missing);
  return {
    body: `${answers.map((a) => a.line).join("\n")}${missing ? "\nAdd it from your policy and I'll keep it on file." : ""}`,
    actions: missing ? [editLink(missing.p), SEE] : [SEE],
    refs: policies.length === 1 ? { policyId: policies[0].id } : {},
  };
}

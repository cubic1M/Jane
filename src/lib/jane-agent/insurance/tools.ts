import type Anthropic from "@anthropic-ai/sdk";
import { PREMIUM_FREQUENCIES } from "@/config/documents";
import { COVERAGE_FIELDS, HOUSING, POLICY_SOURCE_LABELS } from "@/config/insurance";
import type { PrismaClient } from "@/generated/prisma/client";
import type { ToolOutput } from "@/lib/ask/tools";
import { checkGuardrails } from "@/lib/guardrails";
import { valueWords } from "@/lib/insurance/coverage";
import { kindWords } from "@/lib/insurance/gaps";
import { yearlyPremium } from "@/lib/insurance/policies";
import { formatCents } from "@/lib/money";
import { loadInsuranceSnapshot } from "./snapshot";

// Claude's tools for insurance questions in Jane's chat (spec Phase X): read-only, over
// the person's own profile, with every dollar figure recorded for the guardrails.

const noInput = { type: "object" as const, properties: {}, additionalProperties: false };

export const INSURANCE_TOOLS: Anthropic.Tool[] = [
  {
    name: "insurance_policies",
    description:
      "The person's insurance profile: every policy on file (kind, insurer, price, how often it's paid, deductible, cover limits, what it covers, next renewal date and where it came from), their household facts (own or rent, cars, dependants, pets) and coverage gaps Jane found, each with why it matters. Figures only come from these records; when something isn't on file, say so.",
    input_schema: noInput,
  },
];

export const isInsuranceTool = (name: string) => INSURANCE_TOOLS.some((t) => t.name === name);

export async function runInsuranceTool(
  userId: string,
  name: string,
  _input: unknown,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<ToolOutput> {
  const cents: number[] = [];
  const money = (value: number | null) => {
    if (value === null) return null;
    cents.push(Math.abs(value));
    return formatCents(value);
  };
  if (name !== "insurance_policies") {
    return { content: JSON.stringify({ error: `There's no tool called ${name}.` }), cents };
  }
  const { policies, gaps, household } = await loadInsuranceSnapshot(userId, { client, now });
  const fact = <T>(f: { value: T | null; from: string | null }) =>
    f.value === null
      ? "not known"
      : { value: f.value, from: f.from === "you" ? "they said" : "from their accounts" };
  return {
    content: JSON.stringify({
      policies: policies.map((p) => ({
        what: `${p.carrier} ${kindWords(p.kind)}`,
        status:
          p.status === "found"
            ? "found from payments, not confirmed by the person yet"
            : p.status === "pending"
              ? "starting, waiting for its first payment"
              : "active",
        source: POLICY_SOURCE_LABELS[p.source],
        price: money(p.premiumCents),
        paid: p.premiumFrequency ? PREMIUM_FREQUENCIES[p.premiumFrequency].label : null,
        aYear: money(yearlyPremium(p)),
        deductible: money(p.deductibleCents),
        covers: p.covers && checkGuardrails(p.covers, [p.premiumCents ?? 0]).ok ? p.covers : null,
        limits: Object.fromEntries(
          COVERAGE_FIELDS[p.kind].flatMap((field) => {
            const v = p.coverage[field.key];
            if (v === undefined) return [];
            if (field.type === "money") money(v as number);
            return [[field.label, valueWords(field, v)]];
          }),
        ),
        nextRenewal: p.nextRenewal,
        termMonths: p.termMonths,
      })),
      household: {
        home: household.housing.value
          ? { value: HOUSING[household.housing.value], from: household.housing.from }
          : "not known",
        cars: fact(household.vehicles),
        dependants: fact(household.dependants),
        pets: fact(household.pets),
      },
      gaps: gaps.map((g) => ({ what: g.title, why: g.why })),
    }),
    cents,
  };
}

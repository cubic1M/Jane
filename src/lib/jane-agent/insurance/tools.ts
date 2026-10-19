import type Anthropic from "@anthropic-ai/sdk";
import { PREMIUM_FREQUENCIES } from "@/config/documents";
import { COVERAGE_FIELDS, HOUSING, POLICY_SOURCE_LABELS } from "@/config/insurance";
import type { PrismaClient } from "@/generated/prisma/client";
import type { ToolOutput } from "@/lib/ask/tools";
import { checkGuardrails } from "@/lib/guardrails";
import { valueWords } from "@/lib/insurance/coverage";
import { gapAdvice, kindWords } from "@/lib/insurance/gaps";
import { yearlyPremium } from "@/lib/insurance/policies";
import { quotesFor } from "@/lib/insurance/quotes";
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
  {
    name: "insurance_quotes",
    description:
      "Quotes Jane already got for the person's policies from the insurance partner (spec step 103), cheapest first, and Jane's own pick with why when she reshopped it (demo advice): carrier, rating, price per payment and a year, the saving against what they pay now, and whether the cover and deductible are the same or what's different. Demo quotes are sample prices from a made-up catalog, not real offers; say so. It never asks for new quotes: the person can ask Jane \"find me cheaper car insurance\" for that.",
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
  if (name === "insurance_quotes") return quotesTool(userId, { client, now }, money, cents);
  if (name !== "insurance_policies") {
    return { content: JSON.stringify({ error: `There's no tool called ${name}.` }), cents };
  }
  const { policies, gaps, household, advice } = await loadInsuranceSnapshot(userId, {
    client,
    now,
  });
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
      // What to add is demo advice (spec step 98): only in demo advice mode.
      gaps: gaps.map((g) => {
        if (!advice) return { what: g.title, why: g.why };
        const add = gapAdvice(g);
        cents.push(...add.cents);
        return { what: g.title, why: g.why, demoAdviceWhatToAdd: add.text };
      }),
    }),
    cents,
  };
}

async function quotesTool(
  userId: string,
  { client, now }: { client: PrismaClient; now: Date },
  money: (value: number | null) => string | null,
  cents: number[],
): Promise<ToolOutput> {
  const { policies, canQuote, shops = [] } = await loadInsuranceSnapshot(userId, { client, now });
  const active = policies.filter((p) => p.status === "active");
  const withQuotes = await Promise.all(
    active.map(async (p) => ({
      policy: p,
      quotes: await quotesFor(userId, p.id, { client, now }),
    })),
  );
  const current = (p: (typeof active)[number]) => yearlyPremium(p);
  return {
    content: JSON.stringify({
      partnerAvailable: canQuote,
      policies: withQuotes
        .filter((w) => w.quotes.length > 0 || shops.some((s) => s.policyId === w.policy.id))
        .map(({ policy, quotes }) => ({
          policy: `${policy.carrier} ${kindWords(policy.kind)}`,
          paysNowAYear: money(current(policy)),
          // Spec step 104: Jane's own pick, only in demo advice mode (shops exist only then).
          janesPick: (() => {
            const shop = shops.find((s) => s.policyId === policy.id && s.pick);
            if (!shop?.pick) return null;
            return {
              carrier: shop.pick.carrier.name,
              aYear: money(shop.pick.annualPremiumCents),
              savingAYear: money(shop.savingCents),
              why: shop.why,
              demoAdvice: true,
            };
          })(),
          quotes: quotes.map((q) => {
            const pays = current(policy);
            return {
              carrier: q.carrier.name,
              rating: q.carrier.rating,
              price: money(q.premiumCents),
              paid: PREMIUM_FREQUENCIES[q.premiumFrequency].label,
              aYear: money(q.annualPremiumCents),
              savingAYear: pays === null ? null : money(pays - q.annualPremiumCents),
              sameCoverAndDeductible: q.sameCover,
              differences: q.differences,
              sample: q.demo,
              goodUntil: q.expiresAt.toISOString().slice(0, 10),
            };
          }),
        })),
    }),
    cents,
  };
}

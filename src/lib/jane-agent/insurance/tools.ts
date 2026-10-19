import type Anthropic from "@anthropic-ai/sdk";
import { PREMIUM_FREQUENCIES } from "@/config/documents";
import {
  COVERAGE_FIELDS,
  HOUSING,
  POLICY_SOURCE_LABELS,
  type PolicyKind,
} from "@/config/insurance";
import type { PrismaClient } from "@/generated/prisma/client";
import type { ToolOutput } from "@/lib/ask/tools";
import { checkGuardrails } from "@/lib/guardrails";
import { valueWords } from "@/lib/insurance/coverage";
import { gapAdvice, kindWords } from "@/lib/insurance/gaps";
import { yearlyPremium } from "@/lib/insurance/policies";
import { quotesFor } from "@/lib/insurance/quotes";
import { adviceMode } from "@/lib/advice-mode";
import { latestCheckup } from "@/lib/insurance/checkups";
import { BENEFIT_LABELS } from "@/config/benefits";
import { loadInsurance } from "@/lib/insurance/profile";
import { listReadings } from "@/lib/insurance/readings";
import { noteLines, readingLines } from "./reading-words";
import { listBenefits, openEnrollmentAtWork, yearlyCost } from "@/lib/insurance/benefits";
import { autopilotOf } from "@/lib/autopilot";
import { autopilotReply } from "./autopilot";
import { eventLabel, listClaims } from "@/lib/insurance/claims";
import { formatCents } from "@/lib/money";
import { loadInsuranceSnapshot } from "./snapshot";

// Claude's tools for insurance questions in Jane's chat (spec Phase X): read-only, over
// the person's own profile, with every dollar figure recorded for the guardrails.

const noInput = { type: "object" as const, properties: {}, additionalProperties: false };

export const INSURANCE_TOOLS: Anthropic.Tool[] = [
  {
    name: "insurance_policies",
    description:
      "The person's insurance profile, and what Jane does with it by herself at their autopilot level: every policy on file (kind, insurer, price, how often it's paid, deductible, cover limits, what it covers, next renewal date and where it came from), their household facts (own or rent, cars, dependants, pets) and coverage gaps Jane found, each with why it matters. Figures only come from these records; when something isn't on file, say so.",
    input_schema: noInput,
  },
  {
    name: "insurance_quotes",
    description:
      "Quotes Jane already got for the person's policies from the insurance partner (spec step 103), cheapest first, and Jane's own pick with why when she reshopped it (demo advice): carrier, rating, price per payment and a year, the saving against what they pay now, and whether the cover and deductible are the same or what's different. Demo quotes are sample prices from a made-up catalog, not real offers; say so. It never asks for new quotes: the person can ask Jane \"find me cheaper car insurance\" for that.",
    input_schema: noInput,
  },
  {
    name: "insurance_checkup",
    description:
      'Jane\'s latest coverage checkup (demo advice; empty for real accounts): each recommendation (a deductible to raise or lower against their savings, too little or too much cover, bundling, full cover on a car worth little, life cover after a new baby) with what it costs or saves a year and the risk it changes. It never runs a new checkup: the person can ask Jane "check my insurance".',
    input_schema: noInput,
  },
  {
    name: "insurance_claims",
    description:
      "Claims the person is tracking with Jane (spec step 107): what happened and when, the insurer and its claims line when known, the claim number, and every step with when it's due and whether it's done. Jane reminds the person; she never files a claim or talks to the insurer for them. For something that just happened, the person can tell Jane, like \"I had a car accident\", for what to do now.",
    input_schema: noInput,
  },
  {
    name: "insurance_benefits",
    description:
      "The person's benefits through work (spec step 150): each benefit found on their pay stub or that they told Jane about (health, dental, vision, life, disability, HSA, FSA), what it costs a paycheck and a year, whether they've confirmed it, and the employer's open enrollment dates. Found benefits don't count until confirmed.",
    input_schema: noInput,
  },
  {
    name: "insurance_documents",
    description:
      "Policies Jane read from the person's uploaded declarations pages and renewal notices (spec step 151): each field she read (insurer, kind, price, deductible, cover limits, renewal date) with where it came from (the document, what they typed, their payments, or the policy already on file), what the rules left out, and whether they've confirmed it. Nothing read is on their insurance until they confirm.",
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
  if (name === "insurance_documents") {
    await loadInsurance(userId, { client, now });
    const readings = await listReadings(userId, { client });
    return {
      content: JSON.stringify({
        documents: readings
          .filter((r) => r.status !== "dismissed")
          .map((r) => ({
            document: r.title,
            updatesPolicyOnFile: r.policyId !== null,
            status: r.status === "waiting" ? "waiting for them to confirm" : "confirmed",
            read: readingLines(r),
            leftOut: noteLines(r),
          })),
      }),
      cents,
    };
  }
  if (name === "insurance_benefits") {
    const [benefits, window] = await Promise.all([
      listBenefits(userId, { client }),
      openEnrollmentAtWork(userId, { client, now }),
    ]);
    return {
      content: JSON.stringify({
        benefits: benefits
          .filter((b) => b.status !== "declined")
          .map((b) => ({
            benefit: BENEFIT_LABELS[b.kind],
            employer: b.employer,
            aPaycheck: money(b.perPayCents),
            aYear: money(yearlyCost(b)),
            status: b.status === "found" ? "found on the pay stub, not confirmed yet" : b.status,
            from: b.source === "asked" ? "they told Jane" : "pay stub",
          })),
        openEnrollmentAtWork: window,
      }),
      cents,
    };
  }
  if (name === "insurance_claims") {
    const claims = await listClaims(userId, { client });
    return {
      content: JSON.stringify({
        claims: claims.map((c) => ({
          what: eventLabel(c.kind, c.event),
          happenedOn: c.happenedOn,
          status: c.status,
          insurer: c.carrier,
          claimsLine: c.claimsPhone,
          claimNumber: c.claimNumber,
          steps: c.steps.map((s) => ({ step: s.label, dueOn: s.dueOn, done: s.doneAt !== null })),
        })),
      }),
      cents,
    };
  }
  if (name === "insurance_checkup") {
    const checkup = (await adviceMode(userId, { client }))
      ? await latestCheckup(userId, { client })
      : null;
    for (const r of checkup?.recommendations ?? []) cents.push(...r.cents.map(Math.abs));
    return {
      content: JSON.stringify(
        checkup
          ? {
              ranOn: checkup.createdAt.toISOString().slice(0, 10),
              why: checkup.reason,
              demoAdvice: true,
              recommendations: checkup.recommendations.map((r) => ({
                change: r.title,
                cost: r.cost,
                risk: r.risk,
              })),
            }
          : { note: "No checkup: it's demo advice, for demo data only, or none has run yet." },
      ),
      cents,
    };
  }
  if (name !== "insurance_policies") {
    return { content: JSON.stringify({ error: `There's no tool called ${name}.` }), cents };
  }
  const {
    policies,
    gaps,
    household,
    advice,
    switches = [],
  } = await loadInsuranceSnapshot(userId, { client, now });
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
      // Spec step 108: what Jane does with insurance by herself at their autopilot level.
      whatJaneDoesByHerself: autopilotReply(await autopilotOf(userId, { client })).body,
      // Spec step 105: switches Jane is doing, and ones finished lately.
      switches: switches.map((sw) => ({
        newPolicy: `${sw.carrier} ${kindWords(sw.kind as PolicyKind)}`,
        replaces: sw.replaces,
        startsOn: sw.startsOn,
        status:
          sw.status === "pending"
            ? "bought, waiting for its first payment; the old policy is cancelled only after"
            : "done: first payment went through and the old policy was cancelled from the start day",
      })),
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
              // Spec step 149: health plans, by name and a year's cost with the usual care.
              plan: q.plan,
              aYearWithUsualCare: q.expectedCostCents === null ? null : money(q.expectedCostCents),
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

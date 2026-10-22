import { loadNeeds, withNeeds } from "@/lib/insurance/need/load";
import { decide, decisionKindOf } from "./decisions";
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
import { cardCover, conditionWords } from "@/lib/insurance/card-cover";
import { latestLife } from "@/lib/insurance/life";
import { listCoverChanges } from "@/lib/insurance/cover-changes";
import { listNegotiations } from "@/lib/insurance/negotiate";
import { listSavings } from "@/lib/insurance/savings";
import { listRisks } from "@/lib/insurance/risks";
import { loadFamily } from "@/lib/insurance/family";
import { loadHealthYear, openDisputeCards } from "@/lib/insurance/health-year";
import { healthYearLines } from "./health-year";
import { claimWorthFor } from "@/lib/insurance/claim-worth-for";
import { isPolicyKind } from "@/config/insurance";
import { noteLines, readingLines } from "./reading-words";
import { listBenefits, openEnrollmentAtWork, yearlyCost } from "@/lib/insurance/benefits";
import { autopilotOf } from "@/lib/autopilot";
import { autopilotAnswer } from "./autopilot";
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
    name: "insurance_life",
    description:
      "Life insurance sized for the person and applied for (spec step 153), demo advice only: the amount and term with the method (years of pay, debts, final expenses, schooling, less savings and cover they have), the term quotes, and where an application stands (health questions, the carrier's offer or review). Jane never applies or buys without the person's tap; to start, they tap Apply in the chat or on /insurance/life.",
    input_schema: noInput,
  },
  {
    name: "insurance_needs",
    description:
      "What cover the person needs, worked out from their own numbers, what they have and the gap (spec step 278): term life (income, debts, schooling, less savings and cover), disability (about 60% of pay a month), umbrella, deductibles by their cash, and car, home and renters liability levels. It is the same working the page and the nightly detectors use. Use it for 'how much life insurance do I need'. The need is demo advice: say so with the label in demo advice mode.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "insurance_decision",
    description:
      "A direct answer, in three sentences or fewer, to an insurance decision the person asks about: whether to get umbrella or life cover, switch car insurance, pay yearly, raise a deductible, keep the work health plan, cancel phone cover, add a teen driver, and so on. Pass their question as they said it. The answer is built from their own policies and numbers; the verdict is demo advice and only given in demo advice mode (say so with the label). Use it instead of listing their policies when they ask what to do. Start with the verdict in words; offer no button unless they asked you to do something Jane can do; for any amount the answer doesn't give, use the calculate tool.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question as the person asked it." },
      },
      required: ["question"],
    },
  },
  {
    name: "insurance_health_year",
    description:
      "Where the person is in their health plan's year (spec step 200): deductible met, out-of-pocket so far and the month the maximum is reached at this pace, FSA money left and its use-it-or-lose-it date, HSA balance, in-network checks for providers they paid, and big bills above the plan's share (a dispute card is opened for the team). Facts only. Say when the plan is the demo bank's sample plan.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "insurance_claim_worth",
    description:
      "Whether a claim is worth making against paying it themselves (spec step 199), for an estimate in dollars: what the insurer would pay after the deductible (a fact), and, in demo advice mode only, the typical three-year premium rise and claims-free discount lost, with the net. Say it as an estimate, never a promise of what the carrier will do. Pass the policy kind (auto, home, renters...) and what happened (accident, theft, damage) when known.",
    input_schema: {
      type: "object",
      properties: {
        estimateDollars: {
          type: "number",
          description: "What the damage or loss costs, in dollars.",
        },
        policyKind: { type: "string", description: "auto, home, renters, ..." },
        event: { type: "string", description: "accident, theft or damage, when known." },
      },
      required: ["estimateDollars"],
    },
  },
  {
    name: "insurance_household",
    description:
      "The whole household's cover (spec step 198): who is covered by what (the person, each household member's shared policies, and the people they listed), the gaps for each person (a teen driver not on a car policy, a spouse with no health plan), and the health plans compared for the whole household with both employers' plans counted. A partner's policy is only here if they chose to share it.",
    input_schema: noInput,
  },
  {
    name: "insurance_risks",
    description:
      "Risks Jane noticed in how the person lives that their cover may miss (spec step 197): rideshare or delivery income, a home business, a new dog, an expensive ring or camera, a boat, renting the home out. Each is one question, asked once; says what she saw, whether they've answered (a no is never asked again), and the gap a yes opened.",
    input_schema: noInput,
  },
  {
    name: "insurance_savings",
    description:
      "Cheaper ways to pay for the cover the person keeps (spec step 196): pay in full, autopay, paperless, one carrier for car and home, a safe-driver program, and a higher deductible. Each has its yearly saving and what changes; only a higher deductible lowers the cover. Jane applies one through the insurance partner only on the person's tap.",
    input_schema: noInput,
  },
  {
    name: "insurance_negotiations",
    description:
      "Renewals with a price rise and Jane's calls to the insurer about them (spec step 155): today's price, the renewal price, the best like-for-like quote from the reshop, whether Jane is waiting for the person's OK to call or already called (by their tap, or on autopilot within their limits), what the insurer agreed, and anything it offered that changes the cover (never accepted on the call).",
    input_schema: noInput,
  },
  {
    name: "insurance_cover_changes",
    description:
      "Insurance changes after a life event (spec step 154): a car bought, a move, a new baby, a marriage or a new job, and the changes Jane prepared for each (add the car, update the address, add a spouse or the baby, review life cover or benefits), whether each is waiting for the person, made (with any new price and the carrier's confirmation) or turned down. Jane makes them with the carrier only on the person's tap, except an address change at the 'everything allowed' level.",
    input_schema: noInput,
  },
  {
    name: "insurance_card_cover",
    description:
      "Cover that comes with the person's credit cards (spec step 152), from a card-benefits catalog our team reviewed: each card's phone protection, rental car cover, extended warranty and trip cover, with the limits and what they must do for it to apply (like paying the phone bill with the card), and any plan they pay for that a card already covers. A card not in the catalog is never assumed to cover anything. Cancelling a duplicate is the finding's own Yes.",
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
  input: unknown,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<ToolOutput> {
  const cents: number[] = [];
  const money = (value: number | null) => {
    if (value === null) return null;
    cents.push(Math.abs(value));
    return formatCents(value);
  };
  if (name === "insurance_quotes") return quotesTool(userId, { client, now }, money, cents);
  if (name === "insurance_life") {
    if (!(await adviceMode(userId, { client }))) {
      return {
        content: JSON.stringify({
          available: false,
          why: "Sizing life cover is advice: only on the demo bank's sample data until a licensed partner is connected.",
        }),
        cents,
      };
    }
    const application = await latestLife(userId, { client });
    return {
      content: JSON.stringify({
        available: true,
        demoAdvice: true,
        application: application && {
          status: application.status,
          amount: money(application.amountCents),
          termYears: application.termYears,
          termWhy: application.termWhy,
          method: application.method.map((l) => ({
            what: l.label,
            amount: money(l.cents),
            adds: l.adds,
          })),
          quotes: application.quotes.map((q) => ({
            carrier: q.carrier.name,
            aMonth: money(q.premiumCents),
            aYear: money(q.annualPremiumCents),
          })),
          decision:
            application.decision?.outcome === "offered"
              ? {
                  offer: money(application.decision.premiumCents),
                  rateClass: application.decision.rateClass,
                }
              : application.decision,
        },
      }),
      cents,
    };
  }
  if (name === "insurance_needs") {
    const needs = await loadNeeds(userId, { client, now });
    if (!needs) {
      return {
        content: JSON.stringify({
          error: "I don't have the policies and income to size cover yet.",
        }),
        cents,
      };
    }
    for (const n of needs)
      cents.push(n.needCents, n.haveCents, n.gapCents, ...n.lines.map((l) => l.cents));
    return {
      content: JSON.stringify({
        needs: needs.map((n) => ({
          kind: n.kind,
          unit: n.unit,
          need: money(n.needCents),
          have: money(n.haveCents),
          gap: money(n.gapCents),
          direction: n.direction,
          summary: n.summary,
          working: n.lines.map((l) => `${l.adds ? "+" : "−"} ${money(l.cents)}: ${l.label}`),
        })),
      }),
      cents,
    };
  }
  if (name === "insurance_decision") {
    const question = String((input as { question?: unknown })?.question ?? "").toLowerCase();
    const kind = decisionKindOf(question);
    if (!kind) {
      return {
        content: JSON.stringify({
          error: "That isn't an insurance decision I can answer directly.",
        }),
        cents,
      };
    }
    const snapshot = await withNeeds(userId, await loadInsuranceSnapshot(userId, { client, now }), {
      client,
      now,
    });
    const answer = decide(kind, snapshot, now.toISOString().slice(0, 10));
    for (const m of answer.body.matchAll(/\$([\d,]+(?:\.\d\d)?)/g)) {
      cents.push(Math.round(Number(m[1].replace(/,/g, "")) * 100));
    }
    return {
      content: JSON.stringify({
        decision: kind,
        answer: answer.body,
        demoAdvice: answer.refs.advice === true,
      }),
      cents,
    };
  }
  if (name === "insurance_health_year") {
    const year = await loadHealthYear(userId, { client, now });
    if (!year) {
      return {
        content: JSON.stringify({ found: false, why: "no health plan terms on file" }),
        cents,
      };
    }
    await openDisputeCards(userId, { client, now });
    return {
      content: JSON.stringify({
        plan: year.plan.label,
        samplePlan: year.sample,
        lines: healthYearLines(year),
      }),
      cents: [
        year.progress.deductibleMetCents,
        year.progress.oopSoFarCents,
        year.fsa?.leftCents ?? 0,
        ...year.disputes.flatMap((d) => [d.paidCents, d.shouldPayCents, d.overCents]),
      ],
    };
  }
  if (name === "insurance_claim_worth") {
    const asked = input as { estimateDollars?: unknown; policyKind?: unknown; event?: unknown };
    const dollars = Number(asked.estimateDollars);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      return { content: JSON.stringify({ error: "Give the estimate in dollars." }), cents };
    }
    const result = await claimWorthFor(
      userId,
      {
        amountCents: Math.round(dollars * 100),
        kind: isPolicyKind(asked.policyKind) ? asked.policyKind : null,
        event: typeof asked.event === "string" ? asked.event : null,
      },
      { client },
    );
    if (!result.found) {
      return {
        content: JSON.stringify({ found: false, why: "no policy for that on their profile" }),
        cents,
      };
    }
    const w = result.worth;
    return {
      content: JSON.stringify({
        policy: `${result.policy.carrier} ${w.kind}`,
        estimate: money(w.estimateCents),
        deductible: money(w.deductibleCents),
        insurerWouldPay: money(w.payoutCents),
        underTheDeductible: w.underDeductible,
        ...(result.advice
          ? {
              demoAdvice: true,
              premiumRiseOverThreeYears: money(w.riseCents),
              claimsFreeDiscountLost: money(w.discountAtRiskCents),
              netIfTheyClaim: money(w.netCents),
              looksCheaperTo: w.verdict,
            }
          : {}),
      }),
      cents,
    };
  }
  if (name === "insurance_household") {
    const family = await loadFamily(userId, { client, now });
    return {
      content: JSON.stringify({
        covered: family.rows.map((r) => ({
          who: r.name,
          policies: r.policies.map(
            (p) => `${p.carrier} ${p.kind}${p.owner === "You" ? "" : ` (${p.owner}'s, shared)`}`,
          ),
        })),
        gaps: family.gaps.map((g) => ({ gap: g.title, why: g.why })),
        healthPlansForTheWholeHousehold: family.healthPlans.map((r) => ({
          plan: r.label,
          aYearWithUsualCare: money(r.familyYearlyCents),
        })),
      }),
      cents,
    };
  }
  if (name === "insurance_risks") {
    const risks = await listRisks(userId, { client });
    return {
      content: JSON.stringify({
        risks: risks.map((r) => ({
          kind: r.kind,
          status: r.status === "asked" ? "not asked about yet" : r.status === "yes" ? "yes" : "no",
          saw: `${money(r.amountCents)} with ${r.merchant} on ${r.seenOn}`,
        })),
      }),
      cents,
    };
  }
  if (name === "insurance_savings") {
    const savings = await listSavings(userId, { client });
    return {
      content: JSON.stringify({
        // Largest saving first, the three worth the most marked: so everyone gets the same top
        // three of the same list, however many options there are.
        savings: [...savings]
          .filter((s) => s.status !== "dismissed")
          .sort((a, b) => b.yearlySavingCents - a.yearlySavingCents)
          .map((s, rank) => ({
            mostValuable: rank < 3,
            what: s.kind,
            status: s.status === "offered" ? "waiting for their tap" : s.status,
            aYearLess: money(s.yearlySavingCents),
            lowersCover: s.kind === "higher_deductible",
            ...(s.detail.toDeductibleCents
              ? {
                  deductibleFrom: money(s.detail.fromDeductibleCents ?? null),
                  deductibleTo: money(s.detail.toDeductibleCents),
                }
              : {}),
            ...(s.detail.payNowCents ? { payUpFront: money(s.detail.payNowCents) } : {}),
            ...(s.confirmation ? { confirmation: s.confirmation } : {}),
          })),
      }),
      cents,
    };
  }
  if (name === "insurance_negotiations") {
    const negotiations = await listNegotiations(userId, { client });
    return {
      content: JSON.stringify({
        negotiations: negotiations.map((n) => ({
          status: n.status === "asked" ? "waiting for their OK to call" : n.status,
          today: money(n.currentAnnualCents),
          atRenewal: money(n.renewalAnnualCents),
          sameCoverElsewhere: money(n.competingAnnualCents),
          agreed: money(n.resultAnnualCents),
          calledBy: n.calledBy,
          offeredNotTaken: n.offer,
        })),
      }),
      cents,
    };
  }
  if (name === "insurance_cover_changes") {
    const changes = await listCoverChanges(userId, { client });
    return {
      content: JSON.stringify({
        changes: changes.map((c) => ({
          event: c.event,
          change: c.change,
          status: c.status,
          ...(c.newPremiumCents !== null ? { newPrice: money(c.newPremiumCents) } : {}),
          ...(c.confirmation ? { confirmation: c.confirmation } : {}),
          ...(c.doneBy
            ? { madeBy: c.doneBy === "autopilot" ? "Jane, on autopilot" : "the person" }
            : {}),
        })),
      }),
      cents,
    };
  }
  if (name === "insurance_card_cover") {
    const { cards, duplicates } = await cardCover(userId, { client });
    return {
      content: JSON.stringify({
        cards: cards.map((c) => ({
          card: c.card,
          cover: c.benefits.map((b) => ({
            what: b.label,
            limits: b.limits.map((l) => ({
              label: l.label,
              amount: money(l.cents),
              ...(l.text ? { detail: l.text } : {}),
            })),
            when: conditionWords(b),
          })),
        })),
        payingTwice: duplicates.map((d) => ({
          plan: d.merchant,
          coveredBy: `${d.card} ${d.benefit.toLowerCase()}`,
          aYear: money(d.annualSavingsCents),
          status: d.status,
        })),
      }),
      cents,
    };
  }
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
          // Spec step 155: filed by Jane through the partner, after their review.
          filedByJane: c.filing === "filed",
          draftWaitingForReview: c.filing === "draft",
          claiming: money(c.amountCents ?? null),
          insurerStatus: c.carrierStatus ?? null,
          payout: money(c.payoutCents ?? null),
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
      // Spec steps 108 and 141: what Jane does with insurance by herself.
      whatJaneDoesByHerself: (await autopilotAnswer(userId, { client })).body,
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

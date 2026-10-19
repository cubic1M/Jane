import type Anthropic from "@anthropic-ai/sdk";
import {
  FILING_STATUSES,
  INCOME_KINDS,
  TAX_TAG_ORDER,
  TAX_TAGS,
  isTaxTagKind,
  whatJaneDoes,
} from "@/config/tax";
import type { PrismaClient } from "@/generated/prisma/client";
import type { ToolOutput } from "@/lib/ask/tools";
import { formatCents } from "@/lib/money";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { loadWithholding } from "@/lib/tax-withholding";
import { loadTaxSavings } from "@/lib/tax-savings";
import { loadSelfEmployed } from "@/lib/self-employed";
import { loadRefunds } from "@/lib/tax-refund";
import { filingYear, inFilingSeason, loadReturn } from "@/lib/tax-filing";
import { filingPartnerFor } from "@/lib/filing";
import { loadTaxForms, loadTaxTags } from "@/lib/tax-organizer";
import { loadWorkingProfile } from "@/lib/tax-profile";
import { defaultTaxYear } from "@/planning/tax-pack";
import { stateName } from "@/planning/tax-profile";

// Claude's tax tools in Jane's chat (spec steps 118–127): read-only, over the person's own
// data, through the same loaders as /taxes. Every dollar figure is recorded for the
// guardrails, like the other chat tools (./claude-tools.ts).

type Options = { client: PrismaClient; now: Date };

const noInput = { type: "object" as const, properties: {}, additionalProperties: false };

export const TAX_TOOLS: Anthropic.Tool[] = [
  {
    name: "tax_profile",
    description:
      "The person's tax profile: how they file, dependants, the state they file in and their kinds of income, each marked as told by the person, found by Jane from their accounts (not yet checked) or not set; where Jane saw each kind of income and how much came in over the last year; and what Jane does about taxes by herself at their autopilot level.",
    input_schema: noInput,
  },
  {
    name: "tax_tags",
    description:
      "Spending tagged for the person's taxes this tax year (donations, medical, childcare, education, work expenses): each tag's total and count, and, for one tag, its transactions with date, payee, amount and who tagged it (the person, Jane, or Jane but unsure). Tags never change spending categories or totals.",
    input_schema: {
      type: "object",
      properties: {
        tag: {
          type: "string",
          enum: [...TAX_TAG_ORDER],
          description: "Optional: list this tag's transactions.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "tax_estimate",
    description:
      "Jane's estimate of the person's federal and state tax for the tax year, from their income so far projected to the year's end, their pay stubs and their tax profile: income, adjustments, AGI, the deduction (standard or itemized, with its parts), taxable income, income tax, other taxes, credits, total tax, what's been withheld and paid, and the refund or amount owed; the state's the same way. Every figure is an estimate; also lists what Jane assumed. Say figures as estimates.",
    input_schema: noInput,
  },
  {
    name: "tax_withholding",
    description:
      "Whether the person's federal withholding is on course for the tax Jane estimates: on track, a big refund coming, or a bill coming, with the estimated refund or amount owed and paychecks left this year. In demo advice mode only, also what to put on a new W-4 (Step 4(b) deductions or Step 4(c) extra withholding) for the rest of the year and from January, and what each does to a paycheck. Jane never sends a W-4; the person does.",
    input_schema: noInput,
  },
  {
    name: "tax_savings",
    description:
      "Demo advice mode only: ways for the person to pay less tax this year that Jane found in their accounts (retirement contributions, IRA, HSA and FSA room, itemizing, bunching gifts, student loan interest, education and energy credits, dependent care), each with why, an estimated yearly saving and what to do. Outside demo advice mode it says it isn't available. Say every saving as an estimate.",
    input_schema: noInput,
  },
  {
    name: "tax_self_employed",
    description:
      "Freelance and gig taxes: freelance money in this year, business expenses tagged, the home office and business miles and what they take off, and in demo advice mode the share of each payment to set aside and the estimated tax payments left this year (dates and amounts that add up to what the estimate says is still owed). Say amounts as estimates.",
    input_schema: noInput,
  },
  {
    name: "tax_refunds",
    description:
      "Tax refunds seen in the person's accounts in the last year: federal or state, amount, date, the tax year, how it compares with Jane's estimate for that year, whether its plan was set up, and in demo advice mode only where it could go (emergency fund, high-rate debt, goals behind).",
    input_schema: noInput,
  },
  {
    name: "tax_return",
    description:
      "Filing the person's tax return through the filing partner: the year being filed, whether it's filing season, whether filing through Jane is available for them, and the return's status (ready to review, submitted, accepted) with its federal refund or amount owed. Jane can start a return; only the person can sign and file it, on /taxes/file.",
    input_schema: noInput,
  },
  {
    name: "tax_forms",
    description:
      "The tax forms Jane expects for the tax year from the person's payers and lenders (W-2, 1099s, 1098s): each form, who sends it, the usual date it's sent by, whether the person has it, and whether the payer may not send one because the amount is under the reporting threshold.",
    input_schema: noInput,
  },
];

export const isTaxTool = (name: string) => TAX_TOOLS.some((t) => t.name === name);

export async function runTaxTool(
  userId: string,
  name: string,
  input: unknown,
  { client, now }: Options,
): Promise<ToolOutput> {
  const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const year = defaultTaxYear(now.toISOString().slice(0, 10));
  const cents: number[] = [];
  const money = (value: number) => {
    cents.push(Math.abs(value));
    return formatCents(value);
  };
  const out = (value: unknown): ToolOutput => ({ content: JSON.stringify(value), cents });
  switch (name) {
    case "tax_profile": {
      const { view, autopilot } = await loadWorkingProfile(userId, { client, now });
      return out({
        filingStatus: view.filingStatus.value ? FILING_STATUSES[view.filingStatus.value] : null,
        dependants:
          view.dependants.status === "yours"
            ? {
                childrenUnder17: view.dependants.childrenUnder17,
                otherDependants: view.dependants.otherDependants,
              }
            : null,
        state: view.state.value
          ? { name: stateName(view.state.value), status: view.state.status }
          : null,
        income: {
          status: view.incomeKinds.status,
          kinds: view.incomeKinds.value.map((k) => INCOME_KINDS[k].label),
          seenInAccounts: view.incomeKinds.found.map((f) => ({
            kind: INCOME_KINDS[f.kind].label,
            form: INCOME_KINDS[f.kind].form,
            from: f.from,
            lastYear: money(f.totalCents),
          })),
        },
        complete: view.complete,
        janeDoesByHerself: whatJaneDoes(autopilot),
      });
    }
    case "tax_tags": {
      const view = await loadTaxTags(userId, year, { client });
      const tag = isTaxTagKind(args.tag) ? args.tag : null;
      return out({
        year,
        totals: TAX_TAG_ORDER.map((t) => ({
          tag: TAX_TAGS[t].label,
          count: view.totals[t].count,
          total: money(view.totals[t].totalCents),
        })),
        unsureAbout: view.checks.map((c) => ({
          payee: c.payee,
          taggedAs: TAX_TAGS[c.tag].label,
          thisYear: money(c.totalCents),
        })),
        transactions: tag
          ? view.tagged
              .filter((t) => t.tag === tag)
              .map((t) => ({
                date: t.date,
                payee: t.payee,
                amount: money(t.amountCents),
                taggedBy:
                  t.source === "yours"
                    ? "the person"
                    : t.source === "jane"
                      ? "Jane"
                      : "Jane, unsure",
              }))
          : undefined,
      });
    }
    case "tax_estimate": {
      const view = await loadTaxEstimate(userId, { client, now });
      const e = view.estimate;
      return out({
        year: view.year,
        isAnEstimate: true,
        shareOfYearGone: Math.round(view.elapsed * 100) / 100,
        incomeSoFar: money(view.incomeSoFarCents),
        payFrom: view.pay.source,
        withholdingKnown: view.withholdingKnown,
        federal: {
          filingStatus: FILING_STATUSES[e.filingStatus],
          incomeForTheYear: money(e.totalIncomeCents),
          adjustedGrossIncome: money(e.agiCents),
          deduction: e.deduction.kind,
          deductionAmount: money(
            e.deduction.kind === "itemized" ? e.deduction.itemizedCents : e.deduction.standardCents,
          ),
          taxableIncome: money(e.taxableCents),
          topRate: `${Math.round(e.marginalRate * 100)}%`,
          incomeTax: money(e.incomeTaxCents),
          selfEmploymentTax: money(e.selfEmploymentTaxCents),
          credits: money(
            e.credits.childTaxCreditCents +
              e.credits.otherDependantCreditCents +
              e.credits.additionalChildTaxCreditCents +
              e.credits.earnedIncomeCreditCents,
          ),
          totalTax: money(e.totalTaxCents),
          withheldAndPaid: view.withholdingKnown ? money(e.paidCents) : null,
          refund: view.withholdingKnown && e.refundCents > 0 ? money(e.refundCents) : null,
          owed: view.withholdingKnown && e.refundCents < 0 ? money(-e.refundCents) : null,
        },
        state: e.state && {
          code: e.state.code,
          tax: money(e.state.taxCents),
          refund:
            view.withholdingKnown && e.state.refundCents > 0 ? money(e.state.refundCents) : null,
          owed:
            view.withholdingKnown && e.state.refundCents < 0 ? money(-e.state.refundCents) : null,
          rough: e.state.rough,
        },
        assumptions: view.assumptions,
      });
    }
    case "tax_withholding": {
      const { check, estimate, advice } = await loadWithholding(userId, { client, now });
      const change = (
        c: {
          step: string;
          amountCents: number;
          perPaycheckCents: number;
          refundAfterCents: number;
        } | null,
      ) =>
        c && {
          w4Step:
            c.step === "4b"
              ? "Step 4(b) deductions, a yearly amount"
              : "Step 4(c) extra withholding per paycheck",
          amount: money(c.amountCents),
          changeInEachPaycheck: money(-c.perPaycheckCents),
          estimateAfter:
            c.refundAfterCents >= 0
              ? `refund ${money(c.refundAfterCents)}`
              : `owed ${money(-c.refundAfterCents)}`,
        };
      if (check.status === "unknown")
        return out({ year: estimate.year, status: check.status, why: check.why });
      return out({
        year: estimate.year,
        isAnEstimate: true,
        status: check.status,
        refund: check.refundCents >= 0 ? money(check.refundCents) : null,
        owed: check.refundCents < 0 ? money(-check.refundCents) : null,
        w4Sent: estimate.w4 ? { on: estimate.w4.changedOn } : null,
        ...(check.status === "on_track"
          ? {}
          : {
              paychecksLeft: check.paychecksLeft,
              demoAdvice: advice
                ? { thisYear: change(check.thisYear), fromJanuary: change(check.fromJanuary) }
                : "Not available: W-4 suggestions are demo advice only. Point them to the IRS Tax Withholding Estimator.",
            }),
      });
    }
    case "tax_savings": {
      const view = await loadTaxSavings(userId, { client, now });
      if (!view.advice) {
        return out({
          available: false,
          why: "Tax-saving suggestions are demo advice only for now.",
        });
      }
      return out({
        year: view.year,
        isAnEstimate: true,
        savings: view.savings.map((s) => ({
          what: s.title,
          why: s.why,
          estimatedSavingAYear: money(s.estimateCents),
          todo:
            s.action.kind === "task"
              ? `Reminder: ${s.action.title} by ${s.action.dueOn}`
              : s.action.kind === "goal"
                ? `Goal: ${s.action.name}, ${money(s.action.targetCents)} by ${s.action.targetDate}`
                : `Open ${s.action.href}`,
        })),
      });
    }
    case "tax_self_employed": {
      const v = await loadSelfEmployed(userId, { client, now });
      return out({
        year: v.year,
        isAnEstimate: true,
        freelance: v.active,
        freelanceInSoFar: money(v.freelanceInCents),
        businessExpensesTagged: money(v.businessCents),
        homeOffice: v.homeOffice.sqft
          ? { squareFeet: v.homeOffice.sqft, deduction: money(v.homeOffice.deductionCents) }
          : null,
        businessMiles: { miles: v.mileage.miles, deduction: money(v.mileage.deductionCents) },
        demoAdvice: v.advice
          ? {
              setAsideShareOfEachPayment: `${Math.round(v.setAsideRate * 100)}%`,
              federalStillOwed: money(v.federal.owedCents),
              estimatedPayments: v.federal.payments.map((p) => ({
                due: p.date,
                federal: money(p.cents),
              })),
            }
          : "Not available: set-aside and payment amounts are demo advice only. Due dates: Apr 15, Jun 15, Sep 15, Jan 15.",
      });
    }
    case "tax_refunds": {
      const { advice, refunds } = await loadRefunds(userId, { client, now });
      return out({
        refunds: refunds.map((r) => ({
          to: r.refund.to,
          amount: money(r.refund.cents),
          landed: r.refund.date,
          taxYear: r.refund.taxYear,
          estimatedRefund: r.match ? money(r.match.estimatedCents) : null,
          matchesEstimate: r.match?.matches ?? null,
          planSetUp: r.handled,
          demoAdvice:
            advice && r.plan
              ? r.plan.items.map((i) => ({ to: i.label, amount: money(i.cents) }))
              : undefined,
        })),
      });
    }
    case "tax_return": {
      const today = now.toISOString().slice(0, 10);
      const fy = filingYear(today);
      const [partner, ret] = await Promise.all([
        filingPartnerFor(userId, { client }),
        loadReturn(userId, fy, { client, now }),
      ]);
      return out({
        year: fy,
        filingSeason: inFilingSeason(fy, today),
        availableThroughJane: partner !== null,
        deadline: `${fy + 1}-04-15`,
        return: ret && {
          status: ret.status,
          federal:
            ret.preview.federalRefundCents >= 0
              ? `refund ${money(ret.preview.federalRefundCents)}`
              : `owed ${money(-ret.preview.federalRefundCents)}`,
          signedBy: ret.signerName,
        },
      });
    }
    case "tax_forms": {
      const view = await loadTaxForms(userId, year, { client, now });
      return out({
        year,
        forms: view.forms.map((f) => ({
          form: f.form,
          from: f.from,
          for: f.what,
          usuallySentBy: f.by,
          received: f.received,
          mayNotSend: f.mayNotSend,
          amountSeen: f.amountCents === null ? null : money(f.amountCents),
        })),
      });
    }
    default:
      return { content: JSON.stringify({ error: `There's no tool called ${name}.` }), cents: [] };
  }
}

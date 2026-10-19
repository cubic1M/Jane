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

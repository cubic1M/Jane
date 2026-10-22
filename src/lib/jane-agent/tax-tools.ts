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
import { loadInvestmentTaxes } from "@/lib/investment-taxes";
import { adviceMode } from "@/lib/advice-mode";
import { filingYear, inFilingSeason, loadReturn } from "@/lib/tax-filing";
import { filingPartnerFor } from "@/lib/filing";
import { loadTaxTags } from "@/lib/tax-organizer";
import { loadWorkingProfile } from "@/lib/tax-profile";
import { byHerself } from "./replies-autopilot";
import { defaultTaxYear } from "@/planning/tax-pack";
import { stateName } from "@/planning/tax-profile";
import { STATE_SOURCES } from "@/config/tax-states";
import { loadTaxDocuments } from "@/lib/tax-documents";
import { loadTaxPlan } from "@/lib/tax-plan";
import { loadGiving } from "@/lib/giving";
import { loadFamilyTaxes } from "@/lib/family-taxes";
import { NOTICE_KINDS } from "@/config/tax-notices";
import { checkNoticeFor, listTaxNotices, noticeAmountCents } from "@/lib/tax-notices";
import { loadEquityTax } from "@/lib/equity-tax";
import { loadMultiYear } from "@/lib/multi-year";
import { loadPropertyTax } from "@/lib/property-tax";
import { loadAccountantPage } from "@/lib/accountant";
import { DECISION_TOPICS } from "@/config/tax-decisions";
import { decideTax } from "@/lib/tax-decisions";
import { loadTaxCalendar } from "@/lib/tax-calendar";
import { loadIdentity } from "@/lib/tax-identity";
import { loadSideIncome } from "@/lib/side-income";
import { loadReturnReviews } from "@/lib/prior-return/review";
import { loadAuditRecords } from "@/lib/audit-records";
import { loadHomeTaxes } from "@/lib/home-taxes";
import { figuresOf, type Source } from "@/planning/home-taxes";
import { sourceText } from "./home-taxes-message";
import { COMPARED } from "@/planning/tax-document-check";

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
    name: "tax_investments",
    description:
      "Gains and losses in the person's taxable investment accounts for the tax year, from the cost basis their broker reports: realised (sold) and unrealised, each short- and long-term, sales that were wash sales and how much loss that disallowed; in demo advice mode also losses worth harvesting (with the wash-sale risk) and holdings better kept in a 401(k) or IRA. Retirement accounts aren't taxed on gains.",
    input_schema: noInput,
  },
  {
    name: "tax_states",
    description:
      "The person's state and local income taxes for the tax year: each state that taxes some of their income (lived there all year, part of the year after a move, or as a nonresident for an employer in a state that taxes remote work), the dates lived there, the income it taxes, the tax after any credit for tax paid to another state, its tax agency and web address (the source of its figures), and whether its rate is rough; the city or county income tax; the moves Jane counted (told by the person, or spotted by Jane in payments to state agencies and not yet checked) and the employer's state. Every figure is an estimate.",
    input_schema: noInput,
  },
  {
    name: "tax_plan",
    description:
      "The person's year-round tax plan for the tax year: each tax move that applies (workplace plan and IRA or HSA contributions, open enrollment, estimated payments, selling at a loss before year-end, gifts before December 31, a W-4 check after a new job or baby, filing), each with its deadline, when Jane brings it up, what she'd put on their deadlines, and whether it's there already or they said no. Moves past their deadline aren't included. Contribution, sale and gift moves are demo advice.",
    input_schema: noInput,
  },
  {
    name: "tax_giving",
    description:
      "The person's gifts to charity this tax year (tagged as donations): each gift's date, charity and amount, whether it needs the charity's written receipt (gifts of $250 or more) and whether they have it; their donor-advised fund if they opened one; and in demo advice mode the options that do more good for the same money (bunching two years of gifts, a donor-advised fund, giving long-held shares instead of cash), each with the federal tax with and without it. Say the option figures are estimates and demo advice.",
    input_schema: noInput,
  },
  {
    name: "tax_family",
    description:
      "Demo advice only: the person's family tax choices for the tax year, each with both sides' federal tax and whether each side is open to them (with the eligibility rules): claiming their children, a dependent care FSA or the care credit, the American Opportunity or Lifetime Learning credit, a 529's state tax break, and married filing jointly or separately (or head of household or single); plus what Jane assumed. Choosing is the person's.",
    input_schema: noInput,
  },
  {
    name: "tax_home",
    description:
      "What the person's home changes at tax time for the tax year, each figure with where it came from (transactions, the lender's 1098 or loan, or their answers): mortgage interest (on up to the debt limit), property tax paid, the state and local tax cap applied to state income tax and property tax (total, cap, what counts, what doesn't), points, the home office, energy credits from work paid for, and a home sale's gain against the exclusion (with whether it qualifies and why).",
    input_schema: noInput,
  },
  {
    name: "tax_records",
    description:
      "The person's audit-ready records for a tax year: every deduction and credit Jane counts (donations, medical, childcare, education, business, mortgage interest, property tax, energy, student loan interest, home office, miles), each with the transactions, receipts in their document vault, collected forms and answers that support it and what's still needed (for example a charity's receipt for a gift of $250 or more); amounts counted with no source yet (not in the pack); and how long to keep each year's records and when they can be thrown away. Jane never deletes records.",
    input_schema: noInput,
  },
  {
    name: "tax_last_return",
    description:
      "Prior-year returns the person uploaded and confirmed, and in demo advice mode what a review against their accounts found for each: money left behind (itemizing instead of the standard deduction, student loan interest, an education credit, the child and dependent care credit) with the federal tax each would have saved, the last day to amend, whether an amended return is worth preparing, and the state of any amended return (ready for them to review and sign, submitted, accepted). Returns not confirmed aren't used. Amending needs the person's review and signature.",
    input_schema: noInput,
  },
  {
    name: "tax_side_income",
    description:
      "The person's side income for the tax year: a rental (rent in, expenses they tagged, depreciation on the building over 27.5 years, the net, how much of a loss counts under the passive loss allowance and how much carries forward); each gig platform's payouts matched to its 1099 (matched, differs, waiting for the form); whether they treat the income as a business or a hobby; and in demo advice mode the federal tax both ways. All of it is in the estimate, quarterly amounts and tax-time pack.",
    input_schema: noInput,
  },
  {
    name: "tax_notices",
    description:
      "Letters from the IRS or the state the person uploaded: which notice each is (CP2000, CP14, CP501, CP503, CP504, a state notice), what it means in plain words, the amount and the date to respond or pay by, what Jane found against the person's own records (forms collected, income in their accounts, payments seen), in demo advice mode which reply that points to (agree, pay or disagree), and whether a reply is drafted or handed over. Notices not confirmed aren't used. Nothing is paid or sent without the person's tap.",
    input_schema: noInput,
  },
  {
    name: "tax_identity",
    description:
      "The person's tax identity protection: whether they have an IRS Identity Protection PIN for the year and whether Jane put the January reminder on their deadlines; any sign of tax identity theft Jane noticed (a rejected return, a letter that reads like one) or that they reported; and an open case's steps in order (report to the FTC, Form 14039, credit freeze, call the IRS, paper return if the e-file was rejected, IP PIN) with which are done. The steps are the person's own: Jane never contacts the IRS or a bureau.",
    input_schema: noInput,
  },
  {
    name: "tax_equity",
    description:
      "The tax on the person's crypto and equity pay for the tax year: crypto sold (proceeds, cost by lot, short- and long-term gain), what they hold and its unrealised gain, the 1099-DA from an exchange that sold; ESPP sales and whether each was qualifying or a disqualifying disposition that lost its special treatment; ISOs exercised and the alternative minimum tax; RSU vests with the tax withheld against their real rate and the shortfall; and in demo advice mode how much to set aside and whether a goal exists. Holding-period and AMT rules are in config with sources. For RSUs, rsuAnswer is the finished statement of the withholding gap: say it in 2–3 sentences, don't work it out and don't list every detail.",
    input_schema: noInput,
  },
  {
    name: "tax_years",
    description:
      "The person's federal tax projected over the next years: each year's income, tax and top rate (the first is their estimate, the rest assume pay grows until the retirement year they gave, or one Jane assumed, and that the brackets rise with inflation), the total over the years; and in demo advice mode the moves that save tax over the years (a Roth conversion in a low-income year, realising gains in the 0% bracket, bunching charity into alternate years, timing a planned bonus, sale or withdrawal), each with the tax it saves in all. Jane moves no money; a move can be put on the person's deadlines.",
    input_schema: noInput,
  },
  {
    name: "tax_property",
    description:
      "The person's property tax check: their home's assessed value against its market value (their own figures, or sample data), how far over it is and what that costs a year, the county's appeal window and deadline, and in demo advice mode whether an appeal is worth making, the comparable sales behind a drafted appeal, who files it, and exemptions (homestead, senior, veteran, disabled) they may not have claimed with what each does. Jane files and applies for nothing herself.",
    input_schema: noInput,
  },
  {
    name: "tax_accountant",
    description:
      "Where working with an accountant stands: whether the person's taxes include things people usually bring an accountant to (self-employment, rental income, stock options or crypto, income in more than one state, a home sale, an open IRS letter, a tax identity problem, large gains), their read-only accountant links (live, expired or revoked, how many times each was opened), the questions Jane has for an accountant, and the answers that came back. A link shows only tax information, ends on a date the person picks, can be revoked, and every view is logged. Jane never sends a link herself: the person makes and shares it.",
    input_schema: noInput,
  },
  {
    name: "tax_calendar",
    description:
      "The person's tax calendar for this month and the year: what Jane does each month (the January IRS Identity Protection PIN reminder and form chase, estimated payments paid through the payment stand-in a few days before they are due when they fit the person's cap for taxes, the June withholding check, December's year-end moves in one message, filing day and the refund tracked), where each item stands now (done, needs the person's tap, coming, nothing to do), any estimated payment that needs a tap and why (over the cap, over the monthly cap, or the person asked Jane to ask first), and the year-end moves. Nothing is paid above the cap without a tap; signing and filing a return are always the person's.",
    input_schema: noInput,
  },
  {
    name: "tax_decide",
    description:
      "A direct answer, in three sentences or fewer from the person's own numbers, to one of the tax questions people ask: whether to itemize, do a Roth conversion, change their withholding, pay estimated taxes, put more in their 401(k), pick a traditional or Roth IRA, open an HSA, appeal their property tax, sell a loser for the loss, give stock instead of cash, or claim a home office; and the facts: what they will owe or get back, why their refund is what it is, their effective rate, tax paid so far, what they can deduct, how much to set aside, when the next estimated payment is due, whether they must file, and their mortgage interest deduction. Decisions are demo advice and carry the label; for a real account the answer says what the numbers are, not what to do. Start with the verdict in words; offer no button unless they asked you to do something; for any amount these sentences don't give, use the calculate tool. Pass the topic.",
    input_schema: {
      type: "object" as const,
      properties: { topic: { type: "string" as const, enum: [...DECISION_TOPICS] } },
      required: ["topic"],
      additionalProperties: false,
    },
  },
  {
    name: "tax_forms",
    description:
      "The tax forms Jane expects for the tax year from the person's payers and lenders (W-2, 1099s, 1098s): each form, who sends it, the usual date it's sent by, whether the person has it, and whether the payer may not send one because the amount is under the reporting threshold; and the ones Jane collected from the document partner, with whether each matches the person's accounts (a form that doesn't match is flagged and not used until the person says it's right).",
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
      const { view, taxes } = await loadWorkingProfile(userId, { client, now });
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
        janeDoesByHerself: [...whatJaneDoes(taxes.level), byHerself(taxes)],
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
    case "tax_investments": {
      const year = defaultTaxYear(now.toISOString().slice(0, 10));
      const [view, advice] = await Promise.all([
        loadInvestmentTaxes(userId, year, { client, now }),
        adviceMode(userId, { client }),
      ]);
      return out({
        year,
        realised: view.realised.map((r) => ({
          security: r.ticker ?? r.name,
          sold: r.date,
          gain: money(r.gainCents),
          longTerm: money(r.longTermCents),
          shortTerm: money(r.shortTermCents),
          washSaleDisallowed: r.washDisallowedCents > 0 ? money(r.washDisallowedCents) : null,
        })),
        unrealised: view.unrealised.map((u) => ({
          security: u.holding.ticker ?? u.holding.name,
          gain: money(u.gainCents),
          longTerm: money(u.longTermCents),
          shortTerm: money(u.shortTermCents),
        })),
        demoAdvice: advice
          ? {
              harvest: view.harvest.map((h) => ({
                security: h.holding.ticker ?? h.holding.name,
                loss: money(h.lossCents),
                washRisk: h.washRisk,
              })),
              betterInRetirementAccounts: view.location.map((h) => h.name),
            }
          : "Not available: harvesting and where to hold what are demo advice only.",
      });
    }
    case "tax_states": {
      const view = await loadTaxEstimate(userId, { client, now });
      const state = view.estimate.state;
      const r = view.residency;
      return out({
        year: view.year,
        states: (state?.parts ?? []).map((p) => ({
          state: stateName(p.code),
          residence: p.residence,
          livedThere: p.from ? { from: p.from, to: p.to } : null,
          income: money(p.incomeCents),
          tax: money(p.taxCents),
          creditForOtherStates: p.creditCents > 0 ? money(p.creditCents) : null,
          agency: STATE_SOURCES[p.code]?.agency ?? null,
          source: p.url,
          rough: p.rough,
        })),
        local: state?.local
          ? { place: state.local.label, tax: money(state.local.taxCents), source: state.local.url }
          : null,
        total: state ? money(state.taxCents) : null,
        moves: r.inUse.map((m) => ({ ...m, from: stateName(m.from), to: stateName(m.to) })),
        moveSpottedNotChecked: r.usingSpotted,
        employerState: r.workState ? stateName(r.workState) : null,
      });
    }
    case "tax_plan": {
      const plan = await loadTaxPlan(userId, { client, now });
      return out({
        year: plan.year,
        demoAdvice: plan.advice,
        moves: plan.moves.map((m) => ({
          move: m.title,
          deadline: m.deadline,
          bringsUpOn: m.opensOn,
          detail: m.detail,
          amount: m.amountCents === null ? null : money(m.amountCents),
          onDeadlines: m.handled === "added",
          saidNo: m.handled === "no",
          demoAdvice: m.advice,
        })),
      });
    }
    case "tax_giving": {
      const view = await loadGiving(userId, { client, now });
      return out({
        year: view.year,
        given: money(view.totalCents),
        gifts: view.gifts.map((g) => ({
          date: g.date,
          to: g.payee,
          amount: money(g.cents),
          needsReceipt: g.needsReceipt,
          haveReceipt: g.receipted,
        })),
        donorAdvisedFund: view.fund,
        demoAdvice: view.advice
          ? view.options.map((o) => ({
              option: o.title,
              why: o.why,
              taxWith: money(o.withCents),
              taxWithout: money(o.withoutCents),
              saves: money(o.savesCents),
            }))
          : undefined,
      });
    }
    case "tax_family": {
      const view = await loadFamilyTaxes(userId, { client, now });
      return out({
        year: view.year,
        demoAdvice: view.advice,
        choices: view.choices.map((c) => ({
          choice: c.title,
          sides: c.sides.map((s, i) => ({
            option: s.label,
            tax: money(s.taxCents),
            open: s.eligible,
            rules: s.why,
            less: c.better === i,
          })),
          saves: c.better === null ? null : money(c.savesCents),
        })),
        assumed: view.assumptions,
      });
    }
    case "tax_home": {
      const view = await loadHomeTaxes(userId, { client, now });
      const figure = (f: { label: string; cents: number; sources: Source[]; note?: string }) => ({
        figure: f.label,
        amount: money(f.cents),
        from: f.sources.map(sourceText),
        note: f.note ?? null,
      });
      return out({
        year: view.year,
        figures: figuresOf(view).map(figure),
        stateAndLocalTaxCap: {
          total: money(view.salt.totalCents),
          cap: money(view.salt.capCents),
          counts: money(view.salt.allowedCents),
          doesntCount: money(view.salt.overCents),
        },
        sale: view.sale && {
          gain: money(Math.max(0, view.sale.gainCents)),
          exclusion: money(view.sale.exclusionCents),
          taxed: money(view.sale.taxableGainCents),
          qualifies: view.sale.qualifies,
          why: view.sale.why,
        },
      });
    }
    case "tax_records": {
      const view = await loadAuditRecords(userId, year, { client, now });
      const item = (i: (typeof view.items)[number]) => ({
        item: i.label,
        claimed: money(i.claimedCents),
        sources: i.evidence.length,
        stillNeeded: i.needs,
      });
      return out({
        year: view.year,
        pack: view.items.map(item),
        noSourceYet: view.gaps.map(item),
        keepUntil: view.retention.map((r) => ({
          taxYear: r.year,
          keepUntil: r.keepUntil,
          status: r.status,
        })),
        rule: view.retention[0]?.rule ?? null,
      });
    }
    case "tax_last_return": {
      const { advice, reviews } = await loadReturnReviews(userId, { client, now });
      return out({
        demoAdvice: advice,
        returns: reviews.map((r) => ({
          taxYear: r.year,
          found: r.findings.map((f) => ({
            what: f.title,
            why: f.why,
            wouldHaveSaved: money(f.savesCents),
          })),
          total: money(r.totalCents),
          amendBy: r.amendBy,
          worthAmending: r.worthAmending,
          amendedReturn: r.amendment && {
            status: r.amendment.status,
            refund: money(r.amendment.refundCents),
          },
        })),
      });
    }
    case "tax_side_income": {
      const view = await loadSideIncome(userId, { client, now });
      const r = view.rental;
      return out({
        year: view.year,
        rental: r && {
          rentIn: money(r.rentCents),
          expenses: money(r.expensesCents),
          depreciation: money(r.depreciationCents),
          net: money(Math.abs(r.netCents)),
          isLoss: r.netCents < 0,
          countsThisYear: money(Math.abs(r.countedCents)),
          carriesForward: money(r.suspendedCents),
        },
        platforms: view.platforms.map((p) => ({
          platform: p.payer,
          payouts: money(p.payoutsCents),
          form1099: p.formCents === null ? null : money(p.formCents),
          status: p.status,
        })),
        treatedAs: view.kind,
        taxBothWays: view.bothWays && {
          asBusiness: money(view.bothWays.business),
          asHobby: money(view.bothWays.hobby),
        },
      });
    }
    case "tax_notices": {
      const notices = (await listTaxNotices(userId, { client })).filter(
        (n) => n.status === "confirmed",
      );
      const out_ = await Promise.all(
        notices.map(async (n) => {
          const check = await checkNoticeFor(userId, n, { client, now });
          return {
            notice: NOTICE_KINDS[n.kind].title,
            means: NOTICE_KINDS[n.kind].what,
            taxYear: n.fields.taxYear ?? null,
            amount: noticeAmountCents(n) > 0 ? money(noticeAmountCents(n)) : null,
            dueBy: n.dueOn,
            foundInYourRecords: check.lines,
            looksLike: check.advice ? check.points : null,
            why: check.advice && check.points ? check.why : null,
            reply: n.handledBy
              ? `sent by ${n.handledBy === "team" ? "Jane's team" : "the person"}`
              : n.draft
                ? "drafted"
                : "not yet",
          };
        }),
      );
      return out({ notices: out_ });
    }
    case "tax_identity": {
      const v = await loadIdentity(userId, { client, now });
      return out({
        year: v.year,
        ipPin: { have: v.havePin, reminderOnDeadlines: v.reminded, inSeason: v.season },
        signsNoticed: v.candidates.map((c) => ({ sign: c.sign, detail: c.detail })),
        case: v.case && {
          sign: v.case.sign,
          openedOn: v.case.openedOn,
          steps: v.case.steps.map((s) => ({ step: s.title, doneOn: s.doneOn })),
          next: v.case.next,
        },
      });
    }
    case "tax_property": {
      const v = await loadPropertyTax(userId, { client, now });
      return out({
        homeowner: v.homeowner,
        assessed: v.assessedCents === null ? null : money(v.assessedCents),
        marketValue: v.marketCents === null ? null : money(v.marketCents),
        figuresFrom: v.figuresFrom,
        overBy: v.gap
          ? { percent: Math.round(v.gap.gapRate * 100), perYear: money(v.gap.savingCents) }
          : null,
        appealWindow: { status: v.window.status, closes: v.window.closesOn, text: v.window.text },
        advice: v.advice,
        worthAppealing: v.advice ? v.suggested : null,
        comparableSales: v.comps.map((c) => ({
          address: c.address,
          soldOn: c.soldOn,
          price: money(c.priceCents),
        })),
        appeal: v.appeal && { status: v.appeal.status, saves: money(v.appeal.savingCents) },
        exemptions: v.advice
          ? v.exemptions.eligible.map((e) => ({ name: e.name, who: e.who, benefit: e.benefit }))
          : [],
        needToKnow: v.exemptions.ask,
      });
    }
    case "tax_accountant": {
      const v = await loadAccountantPage(userId, { client, now });
      return out({
        situationUsuallyNeedsAnAccountant: v.complexity.complex,
        factors: v.complexity.factors,
        links: v.links.map((l) => ({
          for: l.label,
          state: l.state,
          endsOn: l.expiresOn,
          timesOpened: l.viewCount,
        })),
        questionsForThem: v.questions.map((q) => q.text),
        theirAnswers: v.notes.map((n) => ({
          from: n.fromName,
          about: n.questionText,
          said: n.body,
          seenByPerson: n.seen,
        })),
      });
    }
    case "tax_calendar": {
      const v = await loadTaxCalendar(userId, { client, now });
      return out({
        month: v.label,
        janeActsByHerself: v.acts,
        thisMonth: v.items.map((i) => ({ item: i.title, status: i.status, detail: i.detail })),
        estimatedPaymentsNeedingATap: v.due
          .filter((d) => d.needsTap)
          .map((d) => ({ dueOn: d.dueOn, amount: money(d.cents), why: d.needsTap })),
        yearEndMoves: v.yearEnd?.lines ?? [],
        wholeYear: v.months.map((m) => ({ month: m.label, items: m.items.map((i) => i.title) })),
      });
    }
    case "tax_decide": {
      const topic = DECISION_TOPICS.find((t) => t === args.topic);
      if (!topic) return out({ error: `topic must be one of ${DECISION_TOPICS.join(", ")}` });
      const d = await decideTax(userId, topic, { client, now });
      for (const c of d.figures) cents.push(Math.abs(c));
      return out({
        topic: d.topic,
        answer: d.text,
        isRecommendation: d.advice,
        figuresInCents: d.figures,
      });
    }
    case "tax_years": {
      const v = await loadMultiYear(userId, { client, now });
      return out({
        startYear: v.year,
        retireYear: v.retireYear,
        retireYearAssumed: v.retireAssumed,
        assumptions: v.assumptions,
        years: v.rows.map((r) => ({
          year: r.year,
          income: money(r.incomeCents),
          federalTax: money(r.totalTaxCents),
          topRate: `${Math.round(r.marginalRate * 100)}%`,
        })),
        totalFederalTax: money(v.lifetimeTaxCents),
        moves: v.moves.map((m) => ({
          move: m.title,
          why: m.why,
          savesOverTheYears: money(m.effectCents),
        })),
        advice: v.advice,
      });
    }
    case "tax_equity": {
      const v = await loadEquityTax(userId, { client, now });
      const cryptoUsed = v.cryptoYear.proceedsCents !== 0 || v.income.crypto.holdings.length > 0;
      // Leave out what is empty (no crypto, no events), so the answer is about what they have,
      // and give the RSU gap as a finished statement so no sum is left for Claude to do.
      const gap = v.rsuGap;
      return out({
        year: v.year,
        ...(gap
          ? {
              rsuAnswer: `${
                gap.assumed
                  ? `No vests are on file for ${v.year}, so this assumes a share of your ${money(gap.stockCents)} stock plan vests. `
                  : ""
              }Employers usually withhold a flat rate at vest; at your ${Math.round(gap.marginalRate * 100)}% bracket the withholding falls ${money(gap.shortfallCents)} short on ${money(gap.vestedCents)} of vests.`,
            }
          : {}),
        ...(cryptoUsed
          ? {
              crypto: {
                sold: {
                  proceeds: money(v.cryptoYear.proceedsCents),
                  cost: money(v.cryptoYear.costCents),
                  shortTermGain: money(Math.abs(v.cryptoYear.shortTermCents)),
                  shortTermIsLoss: v.cryptoYear.shortTermCents < 0,
                  longTermGain: money(Math.abs(v.cryptoYear.longTermCents)),
                  longTermIsLoss: v.cryptoYear.longTermCents < 0,
                },
                held: v.income.crypto.holdings.map((h) => ({
                  asset: h.asset,
                  where: h.connection,
                  value: money(h.valueCents),
                  basis: money(h.basisCents),
                  unrealisedGain: money(Math.abs(h.gainCents)),
                  isLoss: h.gainCents < 0,
                })),
                form1099DA: v.forms1099DA,
              },
            }
          : {}),
        ...(v.income.events.length > 0
          ? {
              equityEvents: v.income.events.map((e) => ({
                kind: e.event.kind,
                company: e.event.company,
                shares: e.event.shares,
                on: e.event.occurredOn,
                espp: e.espp && {
                  qualifying: e.espp.qualifying,
                  ordinaryIncome: money(e.espp.ordinaryCents),
                },
                isoAmtPreference: e.iso ? money(e.iso.preferenceCents) : null,
              })),
            }
          : {}),
        ...(v.rsu.length > 0
          ? {
              rsu: v.rsu.map((r) => ({
                company: r.company,
                income: money(r.incomeCents),
                withheld: money(r.withheldCents),
                shortfall: money(r.shortfallCents),
              })),
            }
          : {}),
        rsuWithholdingGap: gap && {
          vested: money(gap.vestedCents),
          shortfall: money(gap.shortfallCents),
          bracket: `${Math.round(gap.marginalRate * 100)}%`,
          assumed: gap.assumed,
        },
        ...(v.amtCents > 0 ? { alternativeMinimumTax: money(v.amtCents) } : {}),
        setAside: v.advice
          ? {
              amount: money(v.setAside.cents),
              parts: v.setAside.parts,
              goalStarted: v.setAside.goalStarted,
            }
          : undefined,
      });
    }
    case "tax_forms": {
      // Spec step 166: with what Jane collected and how each checked against the accounts.
      const view = await loadTaxDocuments(userId, year, { client, now });
      return out({
        year,
        collectedByJane: view.collecting,
        forms: view.forms.map((f) => ({
          form: f.form,
          from: f.from,
          for: f.what,
          usuallySentBy: f.by,
          received: f.received,
          mayNotSend: f.mayNotSend,
          amountSeen: f.amountCents === null ? null : money(f.amountCents),
          collected: f.document
            ? {
                on: f.document.fetchedAt,
                check: f.check!.status,
                formAmount: money(f.check!.formCents),
                compared: COMPARED[f.formKey],
                used: f.usable,
                personSaidRight: f.document.decision === "right",
              }
            : null,
        })),
      });
    }
    default:
      return { content: JSON.stringify({ error: `There's no tool called ${name}.` }), cents: [] };
  }
}

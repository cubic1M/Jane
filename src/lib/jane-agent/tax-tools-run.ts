import type { PrismaClient } from "@/generated/prisma/client";
import {
  FILING_STATUSES,
  INCOME_KINDS,
  TAX_TAG_ORDER,
  TAX_TAGS,
  isTaxTagKind,
  whatJaneDoes,
} from "@/config/tax";
import type { ToolOutput } from "@/lib/ask/tools";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { loadTaxSetAside } from "@/lib/tax-set-aside";
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
import { loadBusinessStructure } from "@/lib/business-structure";
import { loadInheritance } from "@/lib/inheritance";
import { loadHealthTaxes } from "@/lib/health-taxes";
import { loadDisasterRelief } from "@/lib/disasters";
import { loadTaxFound } from "@/lib/tax-scan";
import { MONTH_NAMES } from "@/planning/tax-calendar";
import { loadRetirementTaxes } from "@/lib/retirement-taxes";
import { listDraftReturns } from "@/lib/draft-return";
import { READ_ONLY_TAXES } from "@/config/read-only-beta";
import { DECISION_TOPICS } from "@/config/tax-decisions";
import { conciergeMode } from "@/lib/concierge-mode";
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
import { chatToday } from "@/lib/today";
import { toolAnswer } from "@/lib/ask/tools";

// Runs Claude's tax tools in Jane's chat (./tax-tools.ts lists them): read-only, over the
// person's own data, through the same loaders as /taxes. Every dollar figure is recorded for
// the guardrails, like the other chat tools (./claude-tools.ts).

type Options = { client: PrismaClient; now: Date };

const noIncomeSeen = (year: number) => ({
  year,
  incomeSeen: false,
  note: `No income is on file for ${year}, so there's no estimate. Don't say they owe nothing or nothing is due: say you can't tell yet, and what would let you (a statement from that year, or their income).`,
});

export async function runTaxTool(
  userId: string,
  name: string,
  input: unknown,
  { client, now }: Options,
): Promise<ToolOutput> {
  const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const year = defaultTaxYear(await chatToday(userId, { client, now }));
  const { cents, money, out } = toolAnswer();
  switch (name) {
    case "tax_profile": {
      const { view, taxes } = await loadWorkingProfile(userId, { client, now });
      return out({
        // The label and whether the person said it or Jane found it (as `state` below).
        filingStatus: view.filingStatus.value
          ? { name: FILING_STATUSES[view.filingStatus.value], status: view.filingStatus.status }
          : null,
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
        janeDoesByHerself: (await conciergeMode(userId, { client }))
          ? [...whatJaneDoes(taxes.level), byHerself(taxes)]
          : READ_ONLY_TAXES.lines,
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
      const aside = await loadTaxSetAside(userId, { client, now });
      const view = aside.estimateView;
      const e = view.estimate;
      // No income on file for the year isn't no tax: there's nothing to estimate from.
      if (e.totalIncomeCents === 0) return out(noIncomeSeen(view.year));
      return out({
        year: view.year,
        isAnEstimate: true,
        // The same figure Safe to spend holds back and the card brings up. Null: not known.
        taxOnIncomeSoFar: money(aside.taxSoFarCents),
        withheldOrPaidSoFar: view.withholdingKnown ? money(aside.paidSoFarCents) : null,
        notYetWithheldOrPaid: aside.notYetPaidCents === null ? null : money(aside.notYetPaidCents),
        confidencePercent: aside.confidence.percent,
        whatJaneDoesNotKnow: aside.unknowns,
        correctedByThePerson: view.corrections.length,

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
          // As the refund's card says it ("so it's $10,473 less"), so the chat can too.
          differenceFromEstimate:
            r.match && r.match.diffCents !== 0
              ? `${money(Math.abs(r.match.diffCents))} ${r.match.diffCents > 0 ? "more" : "less"}`
              : null,
          planSetUp: r.handled,
          demoAdvice:
            advice && r.plan
              ? r.plan.items.map((i) => ({ to: i.label, amount: money(i.cents) }))
              : undefined,
        })),
      });
    }
    case "tax_return": {
      const today = await chatToday(userId, { client, now });
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
      const year = defaultTaxYear(await chatToday(userId, { client, now }));
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
            tax: s.unknown ? null : money(s.taxCents),
            // null: depends on the children's ages, which Jane does not have (rules say so).
            open: s.unknown ? null : s.eligible,
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
          assumption: view.sale.assumption ?? undefined,
        },
      });
    }
    case "tax_records": {
      const view = await loadAuditRecords(userId, year, { client, now });
      const item = (i: (typeof view.items)[number]) => ({
        item: i.label,
        claimed: money(i.claimedCents),
        ...(i.gross ? { allPaid: { what: i.gross.label, amount: money(i.gross.cents) } } : {}),
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
        // Spec step 273: every tax suggestion from the whole scan, by the month it belongs in,
        // with its place among everything Jane found for the person.
        foundForThem: (await loadTaxFound(userId, { client, now })).map((f) => ({
          month: MONTH_NAMES[f.month - 1],
          what: f.headline,
          why: f.short,
          worth: money(f.worthCents),
          sure: `${f.percent}%`,
          urgency: f.urgency,
          rankOfEverything: f.rank,
          demoAdvice: f.advice,
        })),
      });
    }
    case "tax_business": {
      const v = await loadBusinessStructure(userId, { client, now });
      const s = v.structure;
      return out({
        profit: s ? money(s.profitCents) : null,
        soleProprietor: s && {
          federalTax: money(s.sole.taxCents),
          qbiDeduction: money(s.sole.qbiCents),
          qbiSavesTax: money(s.sole.qbiSavesCents),
          aboveTheQbiLine: s.sole.qbiLimited,
        },
        sCorporation:
          s && v.advice
            ? {
                worthIt: s.sCorp.worthIt,
                salaryRange: [money(s.sCorp.salaryLowCents), money(s.sCorp.salaryHighCents)],
                totalTaxIncludingCosts: money(s.sCorp.totalCents),
                costs: money(s.sCorp.costsCents),
                saves: money(Math.max(0, s.sCorp.savesCents)),
                costsMoreInstead: s.sCorp.savesCents < 0,
              }
            : null,
        homeOffice: { sqft: v.homeOffice.sqft, deduction: money(v.homeOffice.deductionCents) },
        businessMiles: { miles: v.mileage.miles, deduction: money(v.mileage.deductionCents) },
      });
    }
    case "tax_draft_check": {
      const drafts = (await listDraftReturns(userId, { client })).filter(
        (d) => d.status !== "dismissed",
      );
      return out({
        drafts: drafts.map((d) => ({
          file: d.fileName,
          year: d.year,
          status:
            d.status === "waiting" ? "read, waiting for you to confirm" : "confirmed and checked",
          read: d.fields,
          findings: d.findings.map((f) => ({
            what: f.title,
            line: f.line,
            onTheDraft: money(f.draftCents),
            whatJaneKnows: money(f.knownCents),
            effect: f.effect === "saves" ? "money back" : "more tax owed",
            dollars: money(f.dollarsCents),
            why: f.why,
          })),
        })),
        janeFiles: false,
      });
    }
    case "tax_retirement": {
      const v = await loadRetirementTaxes(userId, { client, now });
      const i = v.irmaa;
      return out({
        socialSecurity: {
          benefitsAYear: money(v.ssBenefitsCents),
          otherIncome: money(v.otherIncomeCents),
          provisionalIncome: money(v.ss.provisionalCents),
          taxable: money(v.ss.taxableCents),
          taxOnItAtTheirBracket: money(Math.round(v.ss.taxableCents * v.bracket)),
          bracket: `${Math.round(v.bracket * 100)}%`,
          rateOnNextIraDollar: `${Math.round(v.nextDollarRate * 100)}%`,
        },
        medicareSurcharge: {
          incomeThisYear: money(v.magiCents),
          setsPremiumsFor: i.premiumYear,
          linesEstimated: i.estimated,
          tier: i.tier,
          monthlySurchargePerPerson: money(i.monthlyPerPersonCents),
          nextLine: i.nextLineCents === null ? null : money(i.nextLineCents),
          roomUnderIt: i.roomCents === null ? null : money(i.roomCents),
          crossingAddsAYear: i.nextYearlyCents === null ? null : money(i.nextYearlyCents),
        },
        tunedOrder: v.advice
          ? {
              preTaxUpTo: v.tuned.preTaxCapCents === null ? null : money(v.tuned.preTaxCapCents),
              thenTaxable: true,
              thenRoth: true,
              isRecommendation: true,
            }
          : null,
      });
    }
    case "tax_disaster": {
      const v = await loadDisasterRelief(userId, { client, now });
      return out({
        county: v.county,
        countyFrom: v.countySource,
        feed: v.feed,
        relief: v.relief.map((r) => ({
          disaster: r.relief.title,
          sample: r.relief.sample,
          state: r.relief.state,
          from: r.relief.incidentFrom,
          deadlinesMoveTo: r.relief.postponedTo,
          stateFollows: r.relief.stateFollows,
          datesCovered: r.computed.map((m) => ({ what: m.title, was: m.from })),
          movedOnTheirList: r.applied,
          onTheirListToMove: r.moves.map((m) => ({ title: m.title, was: m.from })),
          repairsSince: money(r.loss.repairsCents),
          paidBack: money(r.loss.reimbursedCents),
          loss: money(r.loss.lossCents),
          tenPercentOfIncome: money(r.loss.incomeFloorCents),
          deductible: money(r.loss.deductibleCents),
          insuranceClaim: r.claim ? { carrier: r.claim.carrier } : null,
          recordedWithClaim: r.recorded !== null,
        })),
      });
    }
    case "tax_health": {
      const v = await loadHealthTaxes(userId, { client, now });
      const c = v.marketplace.check;
      return out({
        // Null when no income is on file: never $0 for Claude to repeat.
        projectedIncome: v.pace.projectedCents > 0 ? money(v.pace.projectedCents) : null,
        incomeEarlyInTheYear: v.pace.enrollmentCents > 0 ? money(v.pace.enrollmentCents) : null,
        marketplace:
          v.marketplace.payments === 0
            ? null
            : {
                premiumsPaidThisYear: money(v.marketplace.paidCents),
                householdSize: v.householdSize,
                shareOfPovertyLine: c ? `${Math.round(c.fplShare * 100)}%` : null,
                overThe400PercentLine: c?.overCliff ?? false,
                creditAllowed: c ? money(c.allowedCents) : null,
                advanceCredit: money(v.marketplace.advanceYearCents),
                advanceCreditToldByPerson: v.marketplace.told,
                // Unknown (null) when the reader has no check: never $0 for Claude to repeat.
                wouldBeRepaid: c?.repayKnown ? money(c.repayCents) : null,
                repaymentCap: c?.capCents == null ? null : money(c.capCents),
              },
        hsa: {
          deposited: money(v.hsa.contributedCents),
          byDecemberAtThisPace: money(v.hsa.projectedCents),
          cover: v.hsa.family ? "family" : "self-only",
          coverAssumed: v.hsa.coverageAssumed
            ? `not told; family cover assumed for a married filer, self-only limit is ${money(v.hsa.selfLimitCents)}`
            : undefined,
          limit: money(v.hsa.limitCents),
          over: money(Math.max(v.hsa.excessCents, v.hsa.projectedExcessCents)),
          penaltyEachYear: money(v.hsa.exciseCents),
        },
        medical: {
          paidThisYear: money(v.medical.spentCents),
          floor: money(v.medical.floorCents),
          overTheFloor: money(v.medical.deductibleCents),
          standardDeduction: money(v.medical.standardCents),
          itemizingBeatsStandard: v.medical.itemizing,
          itemizingSaves: money(v.medical.savesCents),
        },
      });
    }
    case "tax_inherited": {
      const v = await loadInheritance(userId, { client, now });
      return out({
        inheritedIras: v.inherited.map((i) => ({
          account: i.name,
          balance: money(i.balanceCents),
          fromSpouse: i.fromSpouse,
          mustBeEmptyByEndOf: i.emptyBy,
          diedYearKnown: i.diedYear !== null,
          evenlyPerYear: i.spread && v.advice ? money(i.spread.perYearCents) : null,
          evenlySavesTax: i.spread && v.advice ? money(Math.max(0, i.spread.savesCents)) : null,
        })),
        giftsOverTheExclusion: v.gifts.map((g) => ({
          to: g.recipient,
          total: money(g.cents),
          over: money(g.overCents),
          splittingCoversIt: g.splitCovers,
        })),
        annualExclusionPerPerson: money(v.exclusionCents),
        stepUpInBasis:
          "Inherited property's cost basis becomes its value on the day the owner died, so selling soon after has little or no gain to tax.",
        estateFacts: v.estate,
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
      if (v.rows.every((r) => r.incomeCents === 0)) return out(noIncomeSeen(v.year));
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
                  offeringDateUnknown: e.espp.grantUnknown || undefined,
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

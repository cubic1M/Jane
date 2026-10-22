import type { PrismaClient } from "@/generated/prisma/client";
import { scopedFor } from "@/lib/db-scoped";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { adviceMode } from "@/lib/advice-mode";
import { loadInvestmentTaxes } from "@/lib/investment-taxes";
import { investmentsReply } from "./tax-investments";
import { loadTaxDocuments } from "@/lib/tax-documents";
import { documentsReply } from "./tax-documents-message";
import { loadTaxPlan } from "@/lib/tax-plan";
import { planReply } from "./tax-plan-message";
import { loadGiving } from "@/lib/giving";
import { givingReply } from "./giving-message";
import { loadFamilyTaxes } from "@/lib/family-taxes";
import { familyReply } from "./family-taxes-message";
import { loadHomeTaxes } from "@/lib/home-taxes";
import { loadEquityTax } from "@/lib/equity-tax";
import { MultiYearError, loadMultiYear, setRetireYear } from "@/lib/multi-year";
import { yearsReply } from "./multi-year-message";
import { loadPropertyTax } from "@/lib/property-tax";
import { propertyReply } from "./property-tax-message";
import { loadAccountantPage } from "@/lib/accountant";
import { accountantReply } from "./accountant-message";
import { loadTaxCalendar } from "@/lib/tax-calendar";
import { calendarReply } from "./tax-calendar-message";
import { loadBusinessStructure } from "@/lib/business-structure";
import { businessReply } from "./business-message";
import { loadInheritance } from "@/lib/inheritance";
import { inheritanceReply } from "./inheritance-message";
import { loadHealthTaxes } from "@/lib/health-taxes";
import { healthReply } from "./health-tax-message";
import { loadDisasterRelief } from "@/lib/disasters";
import { disasterReply } from "./disaster-message";
import { correctFact } from "@/lib/profile";
import { decideTax } from "@/lib/tax-decisions";
import { equityReply } from "./equity-tax-message";
import { loadIdentity } from "@/lib/tax-identity";
import { identityReply } from "./tax-identity-message";
import { listTaxNotices } from "@/lib/tax-notices";
import { noticesReply } from "./tax-notice-message";
import { loadSideIncome } from "@/lib/side-income";
import { sideIncomeReply } from "./side-income-message";
import { listPriorReturns } from "@/lib/prior-return";
import { loadReturnReviews } from "@/lib/prior-return/review";
import { lastReturnReply } from "./prior-return-message";
import { loadAuditRecords } from "@/lib/audit-records";
import { recordsReply } from "./audit-records-message";
import { homeReply } from "./home-taxes-message";
import { moveReply, statesReply, workStateReply } from "./tax-states-message";
import { loadWithholding } from "@/lib/tax-withholding";
import { loadTaxSavings } from "@/lib/tax-savings";
import { loadSelfEmployed } from "@/lib/self-employed";
import { loadRefunds } from "@/lib/tax-refund";
import { filingPartnerFor } from "@/lib/filing";
import { filingYear, inFilingSeason, loadReturn } from "@/lib/tax-filing";
import { loadTaxPack } from "@/lib/tax-pack";
import { loadTaxForms, loadTaxTags } from "@/lib/tax-organizer";
import { loadWorkingProfile } from "@/lib/tax-profile";
import { defaultTaxYear } from "@/planning/tax-pack";
import { merchantKeyOf, payeeOf } from "@/planning/tax-tags";
import type { Reply } from "./replies";
import type { TaxIntent } from "./tax-intents";
import {
  bracketReply,
  estimateMessage,
  formsReply,
  packReply,
  setFilingReply,
  setKidsReply,
  setStateReply,
  tagReply,
  tagTotalReply,
  tagsReply,
  taxProfileReply,
  savingsReply,
  fileReply,
  refundReply,
  standardDeductionReply,
  selfEmployedReply,
  withholdingReply,
} from "./tax-replies";

// Answers a typed tax question by rules (spec steps 118–127), with the same loaders as
// /taxes, scoped to the person.

type Options = { client: PrismaClient; now: Date };

// The merchant the person named, among the year's charges: the most charged one whose
// name contains what they typed.
async function findMerchant(userId: string, year: number, target: string, { client }: Options) {
  const words = target.toLowerCase();
  const rows = await scopedFor(userId, client).transactions.findMany({
    where: {
      pending: false,
      amountCents: { gt: 0 },
      date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
      OR: [
        { description: { contains: words, mode: "insensitive" } },
        { merchantName: { contains: words, mode: "insensitive" } },
      ],
    },
    select: { amountCents: true, description: true, merchantName: true },
  });
  const byKey = new Map<
    string,
    { merchantKey: string; payee: string; count: number; totalCents: number }
  >();
  for (const r of rows) {
    const key = merchantKeyOf(r);
    if (!key) continue;
    const m = byKey.get(key) ?? { merchantKey: key, payee: payeeOf(r), count: 0, totalCents: 0 };
    m.count += 1;
    m.totalCents += r.amountCents;
    byKey.set(key, m);
  }
  return (
    [...byKey.values()].sort((a, b) => b.count - a.count || b.totalCents - a.totalCents)[0] ?? null
  );
}

export async function answerTaxIntent(
  userId: string,
  intent: TaxIntent,
  options: Options,
): Promise<Reply> {
  const { client, now } = options;
  const year = defaultTaxYear(now.toISOString().slice(0, 10));
  switch (intent.ask) {
    case "decide": {
      const d = await decideTax(userId, intent.topic, { client, now });
      return {
        body: d.text,
        refs: d.advice ? { advice: true } : {},
        actions: [{ id: "open", label: "See the numbers", kind: "link", href: d.href }],
      };
    }
    case "profile": {
      const { view, autopilot } = await loadWorkingProfile(userId, { client, now });
      return taxProfileReply(view, autopilot);
    }
    case "set_filing":
      return setFilingReply(intent.status);
    case "set_kids":
      return setKidsReply(intent.count);
    case "set_state":
      return setStateReply(intent.state);
    case "move":
    case "work_state": {
      const { view } = await loadWorkingProfile(userId, { client, now });
      return intent.ask === "move"
        ? moveReply(intent, view.state.value, now)
        : workStateReply(intent.state, view.state.value);
    }
    case "disaster":
      return disasterReply(await loadDisasterRelief(userId, { client, now }));
    case "set_county": {
      const name = intent.county.replace(/\b\w/g, (c) => c.toUpperCase());
      await correctFact(userId, "county", name, { client, now });
      const v = await loadDisasterRelief(userId, { client, now });
      const reply = disasterReply(v);
      return { ...reply, body: `Got it: ${name} County.\n${reply.body}` };
    }
    case "health":
      return healthReply(await loadHealthTaxes(userId, { client, now }));
    case "inherited":
      return inheritanceReply(await loadInheritance(userId, { client, now }));
    case "business":
      return businessReply(await loadBusinessStructure(userId, { client, now }));
    case "calendar":
      return calendarReply(await loadTaxCalendar(userId, { client, now }));
    case "accountant":
      return accountantReply(await loadAccountantPage(userId, { client, now }));
    case "property":
      return propertyReply(await loadPropertyTax(userId, { client, now }));
    case "years":
      return yearsReply(await loadMultiYear(userId, { client, now }));
    case "retire_year": {
      try {
        await setRetireYear(userId, intent.year, { client, now, via: "chat" });
      } catch (error) {
        if (error instanceof MultiYearError) return { body: error.message, refs: {}, actions: [] };
        throw error;
      }
      return {
        ...yearsReply(await loadMultiYear(userId, { client, now })),
        body: `Got it: you plan to retire in ${intent.year}. ${yearsReply(await loadMultiYear(userId, { client, now })).body}`,
      };
    }
    case "equity":
      return equityReply(await loadEquityTax(userId, { client, now }));
    case "identity":
      return identityReply(await loadIdentity(userId, { client, now }), intent.sign);
    case "notice":
      return noticesReply(await listTaxNotices(userId, { client }));
    case "side_income":
      return sideIncomeReply(await loadSideIncome(userId, { client, now }));
    case "last_return": {
      const [waiting, reviewed] = await Promise.all([
        listPriorReturns(userId, { client, status: "waiting" }),
        loadReturnReviews(userId, { client, now }),
      ]);
      return lastReturnReply(reviewed.reviews, waiting, reviewed.advice);
    }
    case "records":
      return recordsReply(await loadAuditRecords(userId, year, { client, now }));
    case "home":
      return homeReply(await loadHomeTaxes(userId, { client, now }));
    case "family":
      return familyReply(await loadFamilyTaxes(userId, { client, now }));
    case "giving":
      return givingReply(await loadGiving(userId, { client, now }));
    case "plan":
      return planReply(await loadTaxPlan(userId, { client, now }), now.toISOString().slice(0, 10));
    case "states":
      return statesReply(await loadTaxEstimate(userId, { client, now }));
    case "tags":
      return tagsReply(await loadTaxTags(userId, year, { client }));
    case "tag_total":
      return tagTotalReply(await loadTaxTags(userId, year, { client }), intent.tag);
    case "tag": {
      const view = await loadTaxTags(userId, year, { client });
      return tagReply(
        view,
        await findMerchant(userId, year, intent.target, options),
        intent.target,
        intent.tag,
      );
    }
    case "forms": {
      // Spec step 166: with a document partner, what was collected and how it checked.
      const docs = await loadTaxDocuments(userId, year, { client, now });
      return docs.collecting
        ? documentsReply(docs)
        : formsReply(await loadTaxForms(userId, year, { client, now }));
    }
    case "pack":
      return packReply(await loadTaxPack(userId, year, { client, now }));
    case "estimate":
      return estimateMessage(await loadTaxEstimate(userId, { client, now }));
    case "investments": {
      const [estimate, advice] = await Promise.all([
        loadTaxEstimate(userId, { client, now }),
        adviceMode(userId, { client }),
      ]);
      const view = await loadInvestmentTaxes(userId, estimate.year, { client, now });
      return investmentsReply(view, estimate, advice);
    }
    case "standard_deduction":
      return standardDeductionReply(await loadTaxEstimate(userId, { client, now }));
    case "bracket":
      return bracketReply(await loadTaxEstimate(userId, { client, now }));
    case "withholding":
      return withholdingReply(await loadWithholding(userId, { client, now }));
    case "savings":
      return savingsReply(await loadTaxSavings(userId, { client, now }));
    case "refund": {
      const [refunds, estimate] = await Promise.all([
        loadRefunds(userId, { client, now }),
        loadTaxEstimate(userId, { client, now }),
      ]);
      return refundReply(refunds.refunds, estimate);
    }
    case "file": {
      const today = now.toISOString().slice(0, 10);
      const fy = filingYear(today);
      const [partner, ret, profile] = await Promise.all([
        filingPartnerFor(userId, { client }),
        loadReturn(userId, fy, { client, now }),
        loadWorkingProfile(userId, { client, now }),
      ]);
      return fileReply({
        year: fy,
        inSeason: inFilingSeason(fy, today),
        available: partner !== null,
        ret,
        profile: profile.view,
      });
    }
    case "quarterly":
    case "set_aside":
    case "home_office":
    case "miles":
      return selfEmployedReply(intent, await loadSelfEmployed(userId, { client, now }), now);
  }
}

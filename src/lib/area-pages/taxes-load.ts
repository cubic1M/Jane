import { areaOfCapability } from "@/config/areas";
import { FILING_STATUSES, INCOME_KINDS } from "@/config/tax";
import { scopedFor } from "@/lib/db-scoped";
import { BEST_FIRST, SAID_YES } from "./tree";
import { taxesTree } from "@/lib/area-pages/taxes";
import { loadTaxTags } from "@/lib/tax-organizer";
import { adviceMode } from "@/lib/advice-mode";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { loadTaxSetAside } from "@/lib/tax-set-aside";
import { checkFrom } from "@/lib/tax-withholding";
import { loadTaxSavings } from "@/lib/tax-savings";
import { loadWorkingProfile } from "@/lib/tax-profile";
import { defaultTaxYear } from "@/planning/tax-pack";
import { stateName } from "@/planning/tax-profile";
import { loadInvestmentTaxes } from "@/lib/investment-taxes";
import { loadRefunds } from "@/lib/tax-refund";
import { loadSideIncome } from "@/lib/side-income";
import { loadAuditRecords } from "@/lib/audit-records";
import { loadHomeTaxes } from "@/lib/home-taxes";
import { loadFamilyTaxes } from "@/lib/family-taxes";
import { loadGiving } from "@/lib/giving";
import { loadTaxPlan } from "@/lib/tax-plan";
import { loadTaxDocuments } from "@/lib/tax-documents";

import type { FieldStatus } from "@/planning/tax-profile";
import { todayOf } from "@/lib/today";

// A line of the "what Jane knows" profile on the page.
export type ProfileField = {
  key: string;
  label: string;
  value: string;
  status: FieldStatus;
  // What to say in place of the value, when there's something more useful than "not set".
  note?: string;
};

// Everything the Taxes tree is built from (docs/design/area-pages.md), loaded once for the Taxes
// page and for the home tree, so both show the same statuses.
export async function loadTaxesArea(userId: string, { now = new Date() }: { now?: Date } = {}) {
  // The person's own day: deadlines "soon" and the tax year gathered (last year until the end of
  // April) turn on their today, not UTC's (debugger 11-13).
  const today = await todayOf(userId, { now });
  // The year being gathered: last year until the end of April, then this one.
  const year = defaultTaxYear(today);
  const [{ view, taxes }, tags, forms, estimate, advice, setAside, suggested] = await Promise.all([
    loadWorkingProfile(userId, { now }),
    loadTaxTags(userId, year),
    // Spec step 166: with what Jane collected and how each checked.
    loadTaxDocuments(userId, year, { now }),
    loadTaxEstimate(userId, { now }),
    adviceMode(userId),
    loadTaxSetAside(userId, { now }),
    // Jane's open suggestions about taxes, listed on the page as Money's and Loans' are.
    scopedFor(userId).suggestions.findMany({
      where: { status: { in: [...SAID_YES] } },
      select: {
        status: true,
        capability: true,
        topic: true,
        headline: true,
        short: true,
        why: true,
        worthCents: true,
        worthKind: true,
        urgency: true,
        actionLabel: true,
        actionHref: true,
      },
      orderBy: [...BEST_FIRST],
    }),
  ]);
  const suggestions = suggested.filter((s) => areaOfCapability(s.capability) === "taxes");
  // The audit records are built from the page's own estimate, tags, forms, gifts and home (#687).
  const homeLoad = loadHomeTaxes(userId, { now, loaded: { estimate } });
  // One read of the investment taxes for the page, the giving options and the plan.
  const investmentsLoad = loadInvestmentTaxes(userId, estimate.year, { now });
  const givingLoad = loadGiving(userId, {
    now,
    loaded: { estimate, advice, investments: investmentsLoad },
  });
  const [refunds, investments, savings, sideIncome, records, home, family, giving, plan] =
    await Promise.all([
      loadRefunds(userId, { now }).then((r) => r.refunds),
      investmentsLoad,
      loadTaxSavings(userId, { now, loaded: { estimate, advice } }),
      loadSideIncome(userId, { now, loaded: { estimate } }),
      Promise.all([homeLoad, givingLoad]).then(([home, giving]) =>
        loadAuditRecords(userId, year, {
          now,
          loaded: { estimate, tags, docs: forms, home, giving },
        }),
      ),
      homeLoad,
      loadFamilyTaxes(userId, { now, loaded: { estimate, advice } }),
      givingLoad,
      loadTaxPlan(userId, { now, loaded: { estimate, advice, investments: investmentsLoad } }),
    ]);
  const check = checkFrom(estimate);
  const kids = view.dependants;

  const fields: ProfileField[] = [
    {
      key: "filing",
      label: "How you file",
      value: view.filingStatus.value ? FILING_STATUSES[view.filingStatus.value] : "—",
      status: view.filingStatus.status,
    },
    {
      key: "dependants",
      label: "Dependants",
      value:
        kids.status === "missing"
          ? "—"
          : `${kids.childrenUnder17} under 17, ${kids.otherDependants} other`,
      status: kids.status,
      ...(kids.status === "missing" && kids.hint
        ? { note: "It looks like you have a child. Add them so the credit counts." }
        : {}),
    },
    {
      key: "state",
      label: "State",
      value: stateName(view.state.value) ?? "—",
      status: view.state.status,
    },
    {
      key: "income",
      label: "Income",
      value:
        view.incomeKinds.value.length > 0
          ? view.incomeKinds.value
              .map((k) => `${INCOME_KINDS[k].label} (${INCOME_KINDS[k].form})`)
              .join("; ")
          : "—",
      status: view.incomeKinds.status,
    },
  ];
  // The care credit needs each child's age, which Jane does not have: asked here, with the form.
  if (family.agesMissing) {
    fields.push({
      key: "child-ages",
      label: "Children's ages",
      value: "—",
      status: "missing",
      note: "Tell Jane in the chat how old each child is, so it can check whether childcare counts for the care credit.",
    });
  }
  const newIncome = view.newIncome.map((i) => INCOME_KINDS[i.kind].label.toLowerCase());
  const hasSideIncome = !!sideIncome.rental || sideIncome.platforms.length > 0;

  // The cards that open Giving and Family: their figure and working on the item, while the page
  // lists them (debug 2's class 11, 11-22: "Get receipts for your larger gifts" said the tax at
  // risk, and the item listed only the gifts; the childcare FSA card's $484 was on no item).
  const working = (topic: string) => suggestions.find((s) => s.topic === topic)?.why ?? null;
  const area = taxesTree({
    cards: { giving: working("charity_receipts"), family: working("childcare_tax_break") },
    asOf: today,
    year: estimate.year,
    moves: plan.moves,
    savings: savings.advice ? savings.savings : null,
    estimate: {
      refundCents: estimate.estimate.refundCents,
      withholdingKnown: estimate.withholdingKnown,
      totalTaxCents: estimate.estimate.totalTaxCents,
      incomeCents: estimate.estimate.totalIncomeCents,
    },
    setAside: {
      status: setAside.status,
      advice: setAside.advice,
      holdCents: setAside.holdCents,
      keptApartCents: setAside.keptApartCents,
      percent: setAside.confidence.percent,
      corrections: setAside.estimateView.corrections.length,
    },
    withholding: check.status,
    w4Sent: !!estimate.w4,
    refunds: refunds.length,
    investments:
      investments.taxableAccounts === 0 || !investments.holdingsKnown
        ? null
        : {
            washSales: investments.washSales.length,
            harvest: advice ? investments.harvest.length : 0,
          },
    forms: {
      total: forms.forms.length,
      received: forms.forms.filter((f) => f.received).length,
      toCheck: forms.forms.filter((f) => f.document && !f.usable && f.document.decision === null)
        .length,
    },
    tags: { checks: tags.checks.length, tagged: tags.tagged.length },
    records: {
      items: records.items.length,
      needs: records.items.reduce((n, i) => n + i.needs.length, 0),
      gaps: records.gaps.length,
      canGo: records.retention.filter((r) => r.status !== "keep").length,
    },
    sideIncome: hasSideIncome
      ? {
          differs: sideIncome.platforms.filter((p) => p.status === "differs").length,
          waiting: sideIncome.platforms.filter((p) => p.status === "waiting").length,
        }
      : null,
    home: home.homeowner,
    family: family.advice ? { choices: family.choices.length } : null,
    giving: {
      totalCents: giving.totalCents,
      receiptsMissing: giving.receiptsMissing.length,
      options: giving.advice && !giving.dismissed ? giving.options.length : 0,
    },
    profile: { complete: view.complete, newIncome: newIncome.length, fields },
    suggestions: suggestions.map((s) => ({
      topic: s.topic,
      summary: s.short || s.headline || "",
      worthCents: s.worthCents,
      worthKind: s.worthKind,
      headline: s.headline,
      urgency: s.urgency,
      status: s.status,
      actionHref: s.actionHref,
    })),
  });
  return {
    today,
    year,
    view,
    taxes,
    tags,
    forms,
    estimate,
    setAside,
    advice,
    refunds,
    investments,
    savings,
    sideIncome,
    records,
    home,
    family,
    giving,
    plan,
    check,
    kids,
    fields,
    newIncome,
    suggestions,
    area,
  };
}

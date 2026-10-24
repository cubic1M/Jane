import { FILING_STATUSES, INCOME_KINDS } from "@/config/tax";
import { taxesTree } from "@/lib/area-pages/taxes";
import { loadTaxTags } from "@/lib/tax-organizer";
import { adviceMode } from "@/lib/advice-mode";
import { loadTaxEstimate } from "@/lib/tax-estimate";
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

// A line of the "what Jane knows" profile on the page.
export type ProfileField = { key: string; label: string; value: string; status: FieldStatus };

// Everything the Taxes tree is built from (docs/design/area-pages.md), loaded once for the Taxes
// page and for the home tree, so both show the same statuses.
export async function loadTaxesArea(userId: string, { now = new Date() }: { now?: Date } = {}) {
  const today = now.toISOString().slice(0, 10);
  // The year being gathered: last year until the end of April, then this one.
  const year = defaultTaxYear(today);
  const [{ view, taxes }, tags, forms, estimate, advice] = await Promise.all([
    loadWorkingProfile(userId, { now }),
    loadTaxTags(userId, year),
    // Spec step 166: with what Jane collected and how each checked.
    loadTaxDocuments(userId, year, { now }),
    loadTaxEstimate(userId, { now }),
    adviceMode(userId),
  ]);
  // The audit records are built from the page's own estimate, tags, forms, gifts and home (#687).
  const homeLoad = loadHomeTaxes(userId, { now, loaded: { estimate } });
  const givingLoad = loadGiving(userId, { now, loaded: { estimate, advice } });
  const [refunds, investments, savings, sideIncome, records, home, family, giving, plan] =
    await Promise.all([
      loadRefunds(userId, { now }).then((r) => r.refunds),
      loadInvestmentTaxes(userId, estimate.year, { now }),
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
      loadTaxPlan(userId, { now, loaded: { estimate, advice } }),
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
  const newIncome = view.newIncome.map((i) => INCOME_KINDS[i.kind].label.toLowerCase());
  const hasSideIncome = !!sideIncome.rental || sideIncome.platforms.length > 0;

  const area = taxesTree({
    asOf: today,
    year: estimate.year,
    moves: plan.moves,
    savings: savings.advice ? savings.savings : null,
    estimate: {
      refundCents: estimate.estimate.refundCents,
      withholdingKnown: estimate.withholdingKnown,
    },
    withholding: check.status,
    w4Sent: !!estimate.w4,
    refunds: refunds.length,
    investments:
      investments.taxableAccounts === 0
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
    tags: { checks: tags.checks.length },
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
  });
  return {
    today,
    year,
    view,
    taxes,
    tags,
    forms,
    estimate,
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
    area,
  };
}

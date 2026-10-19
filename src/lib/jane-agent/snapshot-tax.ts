import {
  TAX_FORMS_ASK_FROM,
  TAX_FORMS_ASK_UNTIL,
  TAX_TAG_ORDER,
  type TaxTagKind,
} from "@/config/tax";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { loadTaxEstimate, type TaxEstimateView } from "@/lib/tax-estimate";
import { checkFrom } from "@/lib/tax-withholding";
import { loadTaxSavings } from "@/lib/tax-savings";
import { loadSelfEmployed, type SelfEmployedView } from "@/lib/self-employed";
import { REFUND } from "@/config/tax";
import { loadRefunds, recentRefund, type RefundView } from "@/lib/tax-refund";
import { filingPartnerFor } from "@/lib/filing";
import { filingYear, inFilingSeason, loadReturn, type ReturnView } from "@/lib/tax-filing";
import { JANUARY_READY } from "@/config/tax";
import { loadTaxPack } from "@/lib/tax-pack";
import type { TaxPack } from "@/planning/tax-pack";
import { loadInvestmentTaxes, type InvestmentTaxesView } from "@/lib/investment-taxes";
import type { TaxSaving } from "@/planning/tax-savings";
import type { WithholdingCheck } from "@/planning/withholding";
import { loadTaxForms, loadTaxTags } from "@/lib/tax-organizer";
import { loadTaxPlan, type TaxPlanView } from "@/lib/tax-plan";
import { loadGiving, type GivingView } from "@/lib/giving";
import { loadFamilyTaxes, type FamilyView } from "@/lib/family-taxes";
import { inDocumentSeason, loadTaxDocuments, type TaxDocumentsView } from "@/lib/tax-documents";
import { loadTaxProfile } from "@/lib/tax-profile";
import type { ExpectedForm } from "@/planning/tax-documents";
import type { TaxProfileView } from "@/planning/tax-profile";
import type { TagCheck } from "@/planning/tax-tags";

// What Jane's brain looks at for taxes (spec steps 118–127), loaded with the same code as
// /taxes. Optional on the snapshot, so a test's snapshot can leave it out.

export type TaxSnapshot = {
  tax?: {
    profile: TaxProfileView;
    // Spec step 119: merchants Jane is unsure about this year, what she tagged last month,
    // and, from late January to the filing deadline, last year's forms not yet in.
    tagChecks?: TagCheck[];
    lastMonth?: {
      month: string;
      count: number;
      byTag: { tag: TaxTagKind; count: number; totalCents: number }[];
    };
    formsDue?: { year: number; forms: ExpectedForm[] };
    // Spec step 120: the estimate, worked out fresh after every sync.
    estimate?: TaxEstimateView;
    // Spec step 121: the withholding checkup, and whether the W-4 suggestion may be shown.
    withholding?: WithholdingCheck;
    advice?: boolean;
    // Spec step 122: ways to pay less (demo advice only; empty otherwise).
    savings?: TaxSaving[];
    // Spec step 123: freelancers' taxes.
    selfEmployed?: SelfEmployedView;
    // Spec step 125: a refund that landed lately and hasn't been dealt with.
    refund?: RefundView | null;
    // Spec step 127: in January, last year's pack, for the one "everything's ready" message.
    january?: TaxPack | null;
    // Spec step 124: gains, losses and wash sales in taxable investment accounts.
    investments?: InvestmentTaxesView;
    // Spec step 126: filing season, the partner, and the year's return.
    filing?: { year: number; inSeason: boolean; available: boolean; return: ReturnView | null };
    // Spec step 166: last year's tax forms, collected and checked, in the document season.
    documents?: TaxDocumentsView | null;
    // Spec step 167: the year-round tax plan.
    plan?: TaxPlanView;
    // Spec step 168: gifts, their receipts and the giving options.
    giving?: GivingView;
    // Spec step 169: family tax choices (demo advice).
    family?: FamilyView;
  } | null;
};

const previousMonth = (date: string) => {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
};

export async function loadTaxSnapshot(
  userId: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<TaxSnapshot> {
  const today = now.toISOString().slice(0, 10);
  const year = now.getUTCFullYear();
  const last = previousMonth(today);
  const askForms = today.slice(5) >= TAX_FORMS_ASK_FROM && today.slice(5) <= TAX_FORMS_ASK_UNTIL;
  const [profile, tags, lastMonthTags, forms, estimate, advice] = await Promise.all([
    loadTaxProfile(userId, { client, now }),
    loadTaxTags(userId, year, { client }),
    Number(last.slice(0, 4)) === year
      ? null
      : loadTaxTags(userId, Number(last.slice(0, 4)), { client }),
    askForms ? loadTaxForms(userId, year - 1, { client, now }) : null,
    loadTaxEstimate(userId, { client, now }),
    adviceMode(userId, { client }),
  ]);
  const [savings, selfEmployed] = await Promise.all([
    loadTaxSavings(userId, { client, now, loaded: { estimate, advice } }),
    loadSelfEmployed(userId, { client, now, loaded: { estimate, advice } }),
  ]);
  const inLastMonth = (lastMonthTags ?? tags).tagged.filter((t) => t.date.startsWith(last));
  return {
    tax: {
      profile,
      tagChecks: tags.checks,
      lastMonth: {
        month: last,
        count: inLastMonth.length,
        byTag: TAX_TAG_ORDER.flatMap((tag) => {
          const rows = inLastMonth.filter((t) => t.tag === tag);
          return rows.length > 0
            ? [{ tag, count: rows.length, totalCents: rows.reduce((s, t) => s + t.amountCents, 0) }]
            : [];
        }),
      },
      estimate,
      withholding: checkFrom(estimate),
      savings: savings.savings,
      selfEmployed,
      filing: await (async () => {
        const fy = filingYear(today);
        const [partner, ret] = await Promise.all([
          filingPartnerFor(userId, { client }),
          loadReturn(userId, fy, { client, now }),
        ]);
        return {
          year: fy,
          inSeason: inFilingSeason(fy, today),
          available: partner !== null,
          return: ret,
        };
      })(),
      investments: await loadInvestmentTaxes(userId, estimate.year, { client, now }),
      january:
        today.slice(5) >= JANUARY_READY.from && today.slice(5) <= JANUARY_READY.until
          ? await loadTaxPack(userId, year - 1, { client, now })
          : null,
      refund: recentRefund(
        (await loadRefunds(userId, { client, now, days: REFUND.recentDays })).refunds,
        now,
      ),
      giving: await loadGiving(userId, { client, now, loaded: { estimate, advice } }),
      family: await loadFamilyTaxes(userId, { client, now, loaded: { estimate, advice } }),
      plan: await loadTaxPlan(userId, {
        client,
        now,
        loaded: { estimate, advice, savings, selfEmployed },
      }),
      documents: inDocumentSeason(today)
        ? await loadTaxDocuments(userId, year - 1, { client, now })
        : null,
      advice,
      formsDue: forms
        ? { year: forms.year, forms: forms.forms.filter((f) => !f.received && !f.mayNotSend) }
        : undefined,
    },
  };
}

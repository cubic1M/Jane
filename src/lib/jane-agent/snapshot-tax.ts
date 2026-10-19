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
import type { WithholdingCheck } from "@/planning/withholding";
import { loadTaxForms, loadTaxTags } from "@/lib/tax-organizer";
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
      advice,
      formsDue: forms
        ? { year: forms.year, forms: forms.forms.filter((f) => !f.received && !f.mayNotSend) }
        : undefined,
    },
  };
}

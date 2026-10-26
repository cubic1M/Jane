import type { PrismaClient } from "@/generated/prisma/client";
import {
  POLICY_TYPES,
  PREMIUM_FREQUENCIES,
  RETURN_WINDOW_DAYS,
  type PolicyType,
  type PremiumFrequency,
} from "@/config/documents";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { formatCents } from "@/lib/money";
import { isoDay as day } from "@/lib/dates";

// What the person's documents mean for the rest of Jane (spec step 68): the dates for the
// deadlines list (spec step 71) and the policy behind an insurance card.

type Named = { kind: string; provider: string | null; policyType: string | null; fileName: string };

// How a document is named in lists: "GEICO car insurance", or the file name.
export function documentTitle(document: Named): string {
  if (!document.provider) return document.fileName;
  const type = POLICY_TYPES[document.policyType as PolicyType];
  if (document.kind === "insurance_policy" && type && document.policyType !== "other") {
    return `${document.provider} ${type.toLowerCase()} insurance`;
  }
  return document.provider;
}

export type DocumentDate = {
  documentId: string;
  kind: string;
  title: string;
  // YYYY-MM-DD.
  date: string;
  what: "renewal" | "warranty_end" | "return_window";
};

// Every date the person's documents carry, soonest first: when a policy renews, when a
// warranty ends, and the usual last day to return something on a receipt. Past dates are
// included; callers choose the window they show.
export async function documentDates(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<DocumentDate[]> {
  const documents = await scopedFor(userId, client).documents.findMany({
    where: {
      OR: [
        { renewalDate: { not: null } },
        { warrantyEndsOn: { not: null } },
        { kind: "receipt", purchaseDate: { not: null } },
      ],
    },
    select: {
      id: true,
      kind: true,
      provider: true,
      policyType: true,
      fileName: true,
      renewalDate: true,
      warrantyEndsOn: true,
      purchaseDate: true,
    },
  });

  const dates: DocumentDate[] = [];
  for (const d of documents) {
    const base = { documentId: d.id, kind: d.kind, title: documentTitle(d) };
    if (d.renewalDate) dates.push({ ...base, date: day(d.renewalDate), what: "renewal" });
    if (d.warrantyEndsOn)
      dates.push({ ...base, date: day(d.warrantyEndsOn), what: "warranty_end" });
    if (d.kind === "receipt" && d.purchaseDate) {
      const lastDay = new Date(d.purchaseDate.getTime() + RETURN_WINDOW_DAYS * 86_400_000);
      dates.push({ ...base, date: day(lastDay), what: "return_window" });
    }
  }
  return dates.sort(
    (a, b) => a.date.localeCompare(b.date) || a.documentId.localeCompare(b.documentId),
  );
}

// Words that don't tell insurers apart: "State Farm Mutual Automobile Insurance Co" and
// "STATE FARM INSURANCE" are the same company.
const FILLER = new Set([
  "insurance",
  "ins",
  "insur",
  "assurance",
  "mutual",
  "automobile",
  "company",
  "co",
  "corp",
  "corporation",
  "inc",
  "llc",
  "group",
  "the",
  "of",
  "payment",
  "pmt",
  "premium",
  "policy",
]);

function companyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !FILLER.has(word))
    .join("");
}

// Pure: whether a document's company and a card's merchant name the same insurer.
export function sameCompany(provider: string, merchant: string): boolean {
  const a = companyKey(provider);
  const b = companyKey(merchant);
  if (a.length < 3 || b.length < 3) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

export type PolicyFacts = {
  documentId: string;
  renewalDate: string | null;
  premiumCents: number | null;
  premiumFrequency: string | null;
};

// The person's newest policy from this insurer, for the insurance card. Null when they
// haven't uploaded one.
export async function policyForMerchant(
  userId: string,
  merchant: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<PolicyFacts | null> {
  const policies = await scopedFor(userId, client).documents.findMany({
    where: { kind: "insurance_policy", provider: { not: null } },
    select: {
      id: true,
      provider: true,
      renewalDate: true,
      premiumCents: true,
      premiumFrequency: true,
    },
    orderBy: [{ uploadedAt: "desc" }, { id: "asc" }],
  });
  const policy = policies.find((p) => p.provider && sameCompany(p.provider, merchant));
  if (!policy) return null;
  return {
    documentId: policy.id,
    renewalDate: policy.renewalDate ? day(policy.renewalDate) : null,
    premiumCents: policy.premiumCents,
    premiumFrequency: policy.premiumFrequency,
  };
}

// Pure: what the insurance card says from the policy: "Renews on Mar 1, 2027" and
// "$612.00 every 6 months", each only when the document has it.
export function policyLines(policy: PolicyFacts): string[] {
  const lines: string[] = [];
  if (policy.renewalDate) {
    const date = new Date(`${policy.renewalDate}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
    lines.push(`Renews on ${date}`);
  }
  const frequency = PREMIUM_FREQUENCIES[policy.premiumFrequency as PremiumFrequency];
  if (policy.premiumCents !== null && frequency) {
    lines.push(`${formatCents(policy.premiumCents)} ${frequency.label}`);
  }
  return lines;
}

import { PREMIUM_FREQUENCIES, type PremiumFrequency } from "@/config/documents";
import {
  COVERAGE_FIELDS,
  DEFAULT_TERM_MONTHS,
  MAX_CARRIER_LENGTH,
  MAX_COVERS_LENGTH,
  MAX_DEDUCTIBLE_CENTS,
  MAX_POLICIES,
  MAX_PREMIUM_CENTS,
  POLICY_SOURCES,
  POLICY_STATUSES,
  TERM_MONTHS,
  isPolicyKind,
  type PolicyKind,
  type PolicySource,
  type PolicyStatus,
} from "@/config/insurance";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { checkGuardrails } from "@/lib/guardrails";
import { parseMoneyToCents } from "@/lib/money";
import { CoverageError, fieldText, parseCoverage, readCoverage, type Coverage } from "./coverage";

// The policies on the person's insurance profile (spec step 102): typed on /insurance,
// read from their policy documents (spec step 68), and from step 99 found from payments.
// Every figure Jane says about a policy comes from one of these records.

type Options = { client?: PrismaClient; now?: Date };

export class PolicyError extends Error {}

export type Policy = {
  id: string;
  kind: PolicyKind;
  carrier: string;
  status: PolicyStatus;
  source: PolicySource;
  premiumCents: number | null;
  premiumFrequency: PremiumFrequency | null;
  deductibleCents: number | null;
  coverage: Coverage;
  covers: string | null;
  // YYYY-MM-DD, as recorded (it may be past: see nextRenewal).
  renewalDate: string | null;
  termMonths: number;
  documentId: string | null;
  merchantKey: string | null;
};

export const POLICY_SELECT = {
  id: true,
  kind: true,
  carrier: true,
  status: true,
  source: true,
  premiumCents: true,
  premiumFrequency: true,
  deductibleCents: true,
  coverage: true,
  covers: true,
  renewalDate: true,
  termMonths: true,
  documentId: true,
  merchantKey: true,
} as const;

const day = (date: Date) => date.toISOString().slice(0, 10);
const oneOf = <T extends string>(list: readonly T[], value: string, fallback: T): T =>
  (list as readonly string[]).includes(value) ? (value as T) : fallback;

export function toPolicy(row: Prisma.InsurancePolicyGetPayload<{ select: typeof POLICY_SELECT }>) {
  const kind = isPolicyKind(row.kind) ? row.kind : "other";
  return {
    id: row.id,
    kind,
    carrier: row.carrier,
    status: oneOf(POLICY_STATUSES, row.status, "active"),
    source: oneOf(POLICY_SOURCES, row.source, "typed"),
    premiumCents: row.premiumCents,
    premiumFrequency:
      row.premiumFrequency && Object.hasOwn(PREMIUM_FREQUENCIES, row.premiumFrequency)
        ? (row.premiumFrequency as PremiumFrequency)
        : null,
    deductibleCents: row.deductibleCents,
    coverage: readCoverage(kind, row.coverage),
    covers: row.covers,
    renewalDate: row.renewalDate ? day(row.renewalDate) : null,
    termMonths: row.termMonths,
    documentId: row.documentId,
    merchantKey: row.merchantKey,
  } satisfies Policy;
}

// What a policy costs a year, from its premium and how often it's paid. Null when either
// isn't known.
export function yearlyPremium(policy: Pick<Policy, "premiumCents" | "premiumFrequency">) {
  if (policy.premiumCents === null || !policy.premiumFrequency) return null;
  return policy.premiumCents * PREMIUM_FREQUENCIES[policy.premiumFrequency].perYear;
}

const addMonths = (iso: string, months: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, 1));
  // The same day of the month, or its last day (Jan 31 + 1 month is Feb 28).
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(d, last));
  return day(date);
};

// The next renewal on or after asOf: the recorded date, rolled forward a term at a time
// when it has passed (the policy renewed). Null when no date is recorded.
export function nextRenewal(policy: Pick<Policy, "renewalDate" | "termMonths">, asOf: string) {
  if (!policy.renewalDate) return null;
  let next = policy.renewalDate;
  const term = policy.termMonths > 0 ? policy.termMonths : DEFAULT_TERM_MONTHS;
  for (let i = 0; next < asOf && i < 100; i += 1)
    next = addMonths(policy.renewalDate, term * (i + 1));
  return next;
}

// What the form sends.
export type PolicyInput = {
  kind: string;
  carrier: string;
  premium: string;
  premiumFrequency: string;
  deductible: string;
  renewalDate: string;
  termMonths: string;
  covers: string;
  // coverage.<key> fields, by key.
  coverage: Record<string, string>;
};

type Checked = {
  kind: PolicyKind;
  carrier: string;
  premiumCents: number | null;
  premiumFrequency: PremiumFrequency | null;
  deductibleCents: number | null;
  renewalDate: Date | null;
  termMonths: number;
  covers: string | null;
  coverage: Coverage;
};

function money(raw: string, max: number, message: string): number | null {
  if (!raw.trim()) return null;
  const cents = parseMoneyToCents(raw);
  if (cents === null || cents < 0 || cents > max) throw new PolicyError(message);
  return cents;
}

// Pure: the form's fields, checked. Only the kind and the insurer are needed; anything
// else can be filled in later.
export function checkPolicy(input: PolicyInput): Checked {
  if (!isPolicyKind(input.kind)) throw new PolicyError("Pick what kind of insurance it is.");
  const carrier = input.carrier.replace(/\s+/g, " ").trim();
  if (!carrier || carrier.length > MAX_CARRIER_LENGTH) {
    throw new PolicyError("Enter the insurance company, like “GEICO”.");
  }
  const premiumCents = money(input.premium, MAX_PREMIUM_CENTS, "Enter the price in dollars.");
  const frequency = input.premiumFrequency.trim();
  if (frequency && !Object.hasOwn(PREMIUM_FREQUENCIES, frequency)) {
    throw new PolicyError("Pick how often you pay.");
  }
  if (premiumCents !== null && !frequency) throw new PolicyError("Pick how often you pay.");
  const deductibleCents = money(
    input.deductible,
    MAX_DEDUCTIBLE_CENTS,
    "Enter the deductible in dollars.",
  );
  const renewal = input.renewalDate.trim();
  let renewalDate: Date | null = null;
  if (renewal) {
    renewalDate = new Date(`${renewal}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(renewal) || day(renewalDate) !== renewal) {
      throw new PolicyError("Pick the renewal date.");
    }
  }
  const term = Number(input.termMonths || DEFAULT_TERM_MONTHS);
  if (!(TERM_MONTHS as readonly number[]).includes(term)) {
    throw new PolicyError("Pick how long a term lasts.");
  }
  const covers = input.covers.replace(/\s+/g, " ").trim() || null;
  if (covers && covers.length > MAX_COVERS_LENGTH) {
    throw new PolicyError(`Keep what it covers under ${MAX_COVERS_LENGTH} characters.`);
  }
  let coverage: Coverage;
  try {
    coverage = parseCoverage(input.kind, input.coverage);
  } catch (error) {
    if (error instanceof CoverageError) throw new PolicyError(error.message);
    throw error;
  }
  return {
    kind: input.kind,
    carrier,
    premiumCents,
    premiumFrequency: (frequency || null) as PremiumFrequency | null,
    deductibleCents,
    renewalDate,
    termMonths: term,
    covers,
    coverage,
  };
}

const auditPolicy = (
  userId: string,
  event: "insurance_policy_saved" | "insurance_policy_removed",
  id: string,
  kind: string,
) => logAudit({ type: "user", id: userId }, event, { type: "insurance_policy", id }, { kind });

export async function addPolicy(
  userId: string,
  input: PolicyInput,
  { client = defaultClient }: Options = {},
): Promise<string> {
  const checked = checkPolicy(input);
  const db = scopedFor(userId, client);
  const count = await db.insurancePolicies.count({ where: { status: { not: "removed" } } });
  if (count >= MAX_POLICIES) throw new PolicyError(`You can keep up to ${MAX_POLICIES} policies.`);
  const row = await db.insurancePolicies.create({
    data: { ...checked, userId, source: "typed", status: "active" },
    select: { id: true },
  });
  await auditPolicy(userId, "insurance_policy_saved", row.id, checked.kind);
  await track(userId, "insurance_policy_added", { kind: checked.kind, source: "typed" });
  return row.id;
}

export async function updatePolicy(
  userId: string,
  id: string,
  input: PolicyInput,
  { client = defaultClient }: Options = {},
): Promise<void> {
  const checked = checkPolicy(input);
  // A policy found from payments is confirmed by saving its details.
  const { count } = await scopedFor(userId, client).insurancePolicies.updateMany({
    where: { id, status: { in: ["active", "found", "pending"] } },
    data: { ...checked },
  });
  if (count === 0) throw new PolicyError("That isn't one of your policies.");
  await auditPolicy(userId, "insurance_policy_saved", id, checked.kind);
  await track(userId, "insurance_policy_updated", { kind: checked.kind });
}

// Off the profile. A typed policy is deleted; one read from a document (or found from
// payments) is kept as removed, so it isn't added back from the same document.
export async function removePolicy(
  userId: string,
  id: string,
  { client = defaultClient }: Options = {},
): Promise<void> {
  const db = scopedFor(userId, client);
  const policy = await db.insurancePolicies.findFirst({
    where: { id, status: { not: "removed" } },
    select: { id: true, kind: true, source: true },
  });
  if (!policy) throw new PolicyError("That isn't one of your policies.");
  if (policy.source === "typed") await db.insurancePolicies.deleteMany({ where: { id } });
  else await db.insurancePolicies.updateMany({ where: { id }, data: { status: "removed" } });
  await auditPolicy(userId, "insurance_policy_removed", id, policy.kind);
  await track(userId, "insurance_policy_removed", { kind: policy.kind });
}

// Documents' policy types are the same words, except "health" and "other".
const DOCUMENT_KIND: Record<string, PolicyKind> = {
  auto: "auto",
  home: "home",
  renters: "renters",
  life: "life",
  health: "health",
  other: "other",
};

// Every uploaded policy document with an insurer on it becomes a policy on the profile
// (once: a document's policy is never added twice, even after it's removed). Its facts
// are copied; the person adds the deductible and limits on /insurance.
export async function policiesFromDocuments(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<number> {
  const db = scopedFor(userId, client);
  const [documents, linked] = await Promise.all([
    db.documents.findMany({
      where: { kind: "insurance_policy", provider: { not: null } },
      select: {
        id: true,
        provider: true,
        policyType: true,
        coverageSummary: true,
        premiumCents: true,
        premiumFrequency: true,
        renewalDate: true,
      },
    }),
    db.insurancePolicies.findMany({
      where: { documentId: { not: null } },
      select: { documentId: true },
    }),
  ]);
  const have = new Set(linked.map((l) => l.documentId));
  const fresh = documents.filter((d) => !have.has(d.id));
  if (fresh.length === 0) return 0;
  const { count } = await db.insurancePolicies.createMany({
    data: fresh.map((d) => {
      const covers =
        d.coverageSummary && checkGuardrails(d.coverageSummary, [d.premiumCents ?? 0]).ok
          ? d.coverageSummary
          : null;
      return {
        userId,
        kind: DOCUMENT_KIND[d.policyType ?? ""] ?? "other",
        carrier: d.provider!.slice(0, MAX_CARRIER_LENGTH),
        source: "document",
        status: "active",
        premiumCents: d.premiumCents,
        premiumFrequency: d.premiumFrequency,
        renewalDate: d.renewalDate,
        covers,
        documentId: d.id,
      };
    }),
    skipDuplicates: true,
  });
  if (count > 0) await track(userId, "insurance_policy_added", { source: "document", count });
  return count;
}

// The policies on the profile: active ones first by kind, then found ones waiting for a
// yes, then pending switches. Cancelled and removed ones aren't on it.
export async function listPolicies(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<Policy[]> {
  await policiesFromDocuments(userId, { client });
  const rows = await scopedFor(userId, client).insurancePolicies.findMany({
    where: { status: { in: ["active", "found", "pending"] } },
    select: POLICY_SELECT,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const order: Record<string, number> = { active: 0, pending: 1, found: 2 };
  return rows.map(toPolicy).sort((a, b) => order[a.status] - order[b.status]);
}

// A policy as the edit form shows it.
export function policyFormValues(policy: Policy): PolicyInput {
  const coverage: Record<string, string> = {};
  for (const field of COVERAGE_FIELDS[policy.kind]) {
    coverage[field.key] = fieldText(field, policy.coverage[field.key]);
  }
  const dollars = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2));
  return {
    kind: policy.kind,
    carrier: policy.carrier,
    premium: dollars(policy.premiumCents),
    premiumFrequency: policy.premiumFrequency ?? "",
    deductible: dollars(policy.deductibleCents),
    renewalDate: policy.renewalDate ?? "",
    termMonths: String(policy.termMonths),
    covers: policy.covers ?? "",
    coverage,
  };
}

export const EMPTY_POLICY_INPUT: PolicyInput = {
  kind: "auto",
  carrier: "",
  premium: "",
  premiumFrequency: "",
  deductible: "",
  renewalDate: "",
  termMonths: String(DEFAULT_TERM_MONTHS),
  covers: "",
  coverage: {},
};

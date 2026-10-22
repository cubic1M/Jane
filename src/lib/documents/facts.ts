import {
  DOCUMENT_KINDS,
  DOCUMENT_YEARS,
  MAX_FACT_LENGTH,
  POLICY_TYPES,
  PREMIUM_FREQUENCIES,
  type DocumentKind,
  type PolicyType,
  type PremiumFrequency,
} from "@/config/documents";
import { parseMoneyToCents } from "@/lib/money";

// The key facts of a document (spec step 68), from Claude or typed by the person. Both go
// through the same parsers; Claude's answer is read leniently (a bad field is left blank),
// the person's strictly (a bad field is explained).

export type DocumentFacts = {
  provider: string | null;
  policyType: PolicyType | null;
  coverageSummary: string | null;
  premiumCents: number | null;
  premiumFrequency: PremiumFrequency | null;
  renewalDate: Date | null;
  warrantyEndsOn: Date | null;
  purchaseDate: Date | null;
  purchaseAmountCents: number | null;
};

export const EMPTY_FACTS: DocumentFacts = {
  provider: null,
  policyType: null,
  coverageSummary: null,
  premiumCents: null,
  premiumFrequency: null,
  renewalDate: null,
  warrantyEndsOn: null,
  purchaseDate: null,
  purchaseAmountCents: null,
};

// The fields each kind of document has; the rest stay blank.
export const KIND_FIELDS: Record<DocumentKind, (keyof DocumentFacts)[]> = {
  insurance_policy: [
    "provider",
    "policyType",
    "coverageSummary",
    "premiumCents",
    "premiumFrequency",
    "renewalDate",
  ],
  warranty: [
    "provider",
    "coverageSummary",
    "warrantyEndsOn",
    "purchaseDate",
    "purchaseAmountCents",
  ],
  receipt: ["provider", "coverageSummary", "purchaseDate", "purchaseAmountCents"],
  tax_return: ["provider", "coverageSummary"],
  draft_return: ["provider", "coverageSummary"],
  tax_notice: ["provider", "coverageSummary"],
  other: ["provider", "coverageSummary"],
};

export function isDocumentKind(value: unknown): value is DocumentKind {
  return typeof value === "string" && value in DOCUMENT_KINDS;
}

// What the person or Claude wrote for each fact, as text. Blank means not known.
export type RawFacts = Partial<Record<keyof DocumentFacts, string>>;

type Parsed<T> = { value: T } | { error: string };

function parseText(raw: string | undefined): Parsed<string | null> {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return { value: null };
  if (text.length > MAX_FACT_LENGTH) {
    return { error: `Keep it under ${MAX_FACT_LENGTH} characters.` };
  }
  return { value: text };
}

// "2027-03-01" as midnight UTC, or null when blank.
function parseDay(raw: string | undefined): Parsed<Date | null> {
  const text = (raw ?? "").trim();
  if (!text) return { value: null };
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const date = match ? new Date(`${text}T00:00:00Z`) : null;
  if (
    !match ||
    !date ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== text ||
    Number(match[1]) < DOCUMENT_YEARS.min ||
    Number(match[1]) > DOCUMENT_YEARS.max
  ) {
    return { error: "Enter a date like 2027-03-01." };
  }
  return { value: date };
}

function parseAmount(raw: string | undefined): Parsed<number | null> {
  const text = (raw ?? "").trim();
  if (!text) return { value: null };
  const cents = parseMoneyToCents(text);
  if (cents === null || cents < 0) return { error: "Enter an amount like 1,234.56." };
  return { value: cents };
}

function parseChoice<T extends string>(
  raw: string | undefined,
  choices: Record<T, unknown>,
): Parsed<T | null> {
  const text = (raw ?? "").trim();
  if (!text) return { value: null };
  return text in choices ? { value: text as T } : { error: "Pick one from the list." };
}

const PARSERS: {
  [K in keyof DocumentFacts]: (raw: string | undefined) => Parsed<DocumentFacts[K]>;
} = {
  provider: parseText,
  policyType: (raw) => parseChoice(raw, POLICY_TYPES),
  coverageSummary: parseText,
  premiumCents: parseAmount,
  premiumFrequency: (raw) => parseChoice(raw, PREMIUM_FREQUENCIES),
  renewalDate: parseDay,
  warrantyEndsOn: parseDay,
  purchaseDate: parseDay,
  purchaseAmountCents: parseAmount,
};

export const FIELD_LABELS: Record<keyof DocumentFacts, string> = {
  provider: "Company",
  policyType: "Type of policy",
  coverageSummary: "What it covers",
  premiumCents: "Price",
  premiumFrequency: "How often you pay",
  renewalDate: "Renews on",
  warrantyEndsOn: "Warranty ends on",
  purchaseDate: "Bought on",
  purchaseAmountCents: "Price paid",
};

// What "provider" means for each kind of document.
export const PROVIDER_LABELS: Record<DocumentKind, string> = {
  insurance_policy: "Insurance company",
  warranty: "Company",
  receipt: "Store",
  tax_return: "Prepared by",
  draft_return: "Prepared by",
  tax_notice: "Sent by",
  other: "From",
};

export type FactsResult = { ok: true; facts: DocumentFacts } | { ok: false; error: string };

// The person's own facts: every field must make sense, or they're told which one doesn't.
export function factsFromForm(kind: DocumentKind, raw: RawFacts): FactsResult {
  const facts = { ...EMPTY_FACTS };
  for (const field of KIND_FIELDS[kind]) {
    const parsed = PARSERS[field](raw[field]);
    if ("error" in parsed) return { ok: false, error: `${FIELD_LABELS[field]}: ${parsed.error}` };
    Object.assign(facts, { [field]: parsed.value });
  }
  if (facts.premiumCents !== null && facts.premiumFrequency === null) {
    return { ok: false, error: "How often you pay: pick one, so the price makes sense." };
  }
  return { ok: true, facts };
}

// Claude's facts: anything that doesn't parse is left blank for the person to fill in.
export function factsFromClaude(kind: DocumentKind, raw: RawFacts): DocumentFacts {
  const facts = { ...EMPTY_FACTS };
  for (const field of KIND_FIELDS[kind]) {
    const parsed = PARSERS[field](raw[field]);
    if ("value" in parsed) Object.assign(facts, { [field]: parsed.value });
  }
  // A price without how often it's paid can't be compared, so it isn't kept.
  if (facts.premiumFrequency === null) facts.premiumCents = null;
  return facts;
}

// What a premium comes to over a year, or null without both parts.
export function yearlyPremiumCents(facts: {
  premiumCents: number | null;
  premiumFrequency: string | null;
}): number | null {
  if (facts.premiumCents === null || !facts.premiumFrequency) return null;
  const frequency = PREMIUM_FREQUENCIES[facts.premiumFrequency as PremiumFrequency];
  return frequency ? facts.premiumCents * frequency.perYear : null;
}

// The facts as stored: the same fields, with the choices as plain text.
export type StoredFacts = Omit<DocumentFacts, "policyType" | "premiumFrequency"> & {
  policyType: string | null;
  premiumFrequency: string | null;
};

// The facts as form text, for the correction form.
export function rawFacts(facts: StoredFacts): Record<keyof DocumentFacts, string> {
  const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? "";
  const money = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2));
  return {
    provider: facts.provider ?? "",
    policyType: facts.policyType ?? "",
    coverageSummary: facts.coverageSummary ?? "",
    premiumCents: money(facts.premiumCents),
    premiumFrequency: facts.premiumFrequency ?? "",
    renewalDate: day(facts.renewalDate),
    warrantyEndsOn: day(facts.warrantyEndsOn),
    purchaseDate: day(facts.purchaseDate),
    purchaseAmountCents: money(facts.purchaseAmountCents),
  };
}

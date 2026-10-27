import { PREMIUM_FREQUENCIES } from "@/config/documents";
import {
  COVERAGE_FIELDS,
  DEFAULT_TERM_MONTHS,
  MAX_CARRIER_LENGTH,
  MAX_COVERS_LENGTH,
  MAX_DEDUCTIBLE_CENTS,
  MAX_PREMIUM_CENTS,
  READING_PRICE_TOLERANCE,
  READING_RENEWAL_WINDOW_DAYS,
  TERM_MONTHS,
  isPolicyKind,
} from "@/config/insurance";
import { formatCents, parseMoneyToCents, centsToInput } from "@/lib/money";
import { CoverageError, parseCoverage } from "./coverage";
import type { PolicyInput } from "./policies";
import { DAY_MS as DAY } from "@/lib/dates";

// A policy read from a document (spec step 151), before the person confirms it: the fields
// from each place Jane found them, best first, checked by rules. A field that fails a rule
// is left blank with a note saying why; one worth a second look keeps its value and gets a
// note. Pure.

// Where a field came from: Claude reading the document, the facts the person typed on
// Documents, their insurance payments, or the policy already on file (a renewal notice
// leaves the rest as it was).
export type ReadingSource = "document" | "you" | "payments" | "policy";

export const SOURCE_WORDS: Record<ReadingSource, string> = {
  document: "from the document",
  you: "as you typed it",
  payments: "from your payments",
  policy: "as on file",
};

// Field names: the form's, with cover limits as coverage.<key>.
export type Fields = Record<string, string>;
export type Layer = { source: ReadingSource; fields: Fields };

const FLAT_KEYS = [
  "kind",
  "carrier",
  "premium",
  "premiumFrequency",
  "deductible",
  "renewalDate",
  "termMonths",
  "covers",
] as const;

// Pure: the form's fields as flat names, blanks left out.
export function flatten(input: Partial<PolicyInput>): Fields {
  const fields: Fields = {};
  for (const key of FLAT_KEYS) {
    const value = input[key]?.trim();
    if (value) fields[key] = value;
  }
  for (const [key, value] of Object.entries(input.coverage ?? {})) {
    if (value.trim()) fields[`coverage.${key}`] = value.trim();
  }
  return fields;
}

// Pure: back to the form's shape.
export function toInput(fields: Fields): PolicyInput {
  const coverage: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (key.startsWith("coverage.")) coverage[key.slice("coverage.".length)] = value;
  }
  return {
    kind: fields.kind ?? "",
    carrier: fields.carrier ?? "",
    premium: fields.premium ?? "",
    premiumFrequency: fields.premiumFrequency ?? "",
    deductible: fields.deductible ?? "",
    renewalDate: fields.renewalDate ?? "",
    termMonths: fields.termMonths ?? String(DEFAULT_TERM_MONTHS),
    covers: fields.covers ?? "",
    coverage,
  };
}

// Pure: each field from the first layer that has it.
export function mergeLayers(layers: Layer[]): {
  fields: Fields;
  sources: Record<string, ReadingSource>;
} {
  const fields: Fields = {};
  const sources: Record<string, ReadingSource> = {};
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer.fields)) {
      if (key in fields || !value) continue;
      fields[key] = value;
      sources[key] = layer.source;
    }
  }
  return { fields, sources };
}

export type Checked = {
  fields: Fields;
  sources: Record<string, ReadingSource>;
  notes: Record<string, string>;
};

// Pure: the rules. asOf is YYYY-MM-DD; paidYearlyCents what the person's payments to this
// insurer come to in a year, when known.
export function checkReading(
  { fields: given, sources: from }: { fields: Fields; sources: Record<string, ReadingSource> },
  { asOf, paidYearlyCents = null }: { asOf: string; paidYearlyCents?: number | null },
): Checked {
  const fields: Fields = { ...given };
  const sources = { ...from };
  const notes: Record<string, string> = {};
  const drop = (key: string, note: string) => {
    delete fields[key];
    delete sources[key];
    notes[key] = note;
  };

  if (!fields.kind || !isPolicyKind(fields.kind)) {
    if (fields.kind) drop("kind", "Pick what kind of insurance it is.");
    fields.kind = "other";
    notes.kind ??= "Pick what kind of insurance it is.";
  }
  const kind = fields.kind as Parameters<typeof parseCoverage>[0];

  if (fields.carrier) {
    const carrier = fields.carrier.replace(/\s+/g, " ").trim();
    if (carrier.length > MAX_CARRIER_LENGTH) drop("carrier", "I couldn't read the insurer.");
    else fields.carrier = carrier;
  }

  const money = (key: string, max: number, note: string) => {
    if (!fields[key]) return null;
    const cents = parseMoneyToCents(fields[key]);
    if (cents === null || cents < 0 || cents > max) {
      drop(key, note);
      return null;
    }
    fields[key] = centsToInput(cents);
    return cents;
  };
  const premium = money("premium", MAX_PREMIUM_CENTS, "I couldn't read the price.");
  if (fields.premiumFrequency && !Object.hasOwn(PREMIUM_FREQUENCIES, fields.premiumFrequency)) {
    drop("premiumFrequency", "Pick how often you pay.");
  }
  const frequency = fields.premiumFrequency as keyof typeof PREMIUM_FREQUENCIES | undefined;
  if (premium !== null && !frequency) notes.premiumFrequency ??= "Pick how often you pay.";
  if (premium !== null && frequency && paidYearlyCents) {
    const yearly = premium * PREMIUM_FREQUENCIES[frequency].perYear;
    if (Math.abs(yearly - paidYearlyCents) / paidYearlyCents > READING_PRICE_TOLERANCE) {
      notes.premium = `Your payments come to ${formatCents(paidYearlyCents)} a year, so check this.`;
    }
  }

  // Cover limits: each through the same parser as the form; others for this kind dropped.
  const limits: number[] = [];
  for (const key of Object.keys(fields).filter((k) => k.startsWith("coverage."))) {
    const name = key.slice("coverage.".length);
    const field = COVERAGE_FIELDS[kind].find((f) => f.key === name);
    if (!field) {
      delete fields[key];
      delete sources[key];
      continue;
    }
    try {
      const value = parseCoverage(kind, { [name]: fields[key] })[name];
      if (field.type === "money" && typeof value === "number") limits.push(value);
    } catch (error) {
      if (!(error instanceof CoverageError)) throw error;
      drop(key, error.message);
    }
  }

  const deductible = money("deductible", MAX_DEDUCTIBLE_CENTS, "I couldn't read the deductible.");
  if (deductible !== null && limits.length > 0 && deductible > Math.max(...limits)) {
    drop("deductible", "It was higher than the cover limits, so I left it out.");
  }

  if (fields.renewalDate) {
    const text = fields.renewalDate;
    const date = new Date(`${text}T00:00:00Z`);
    const days = (date.getTime() - new Date(`${asOf}T00:00:00Z`).getTime()) / DAY;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== text ||
      days < -READING_RENEWAL_WINDOW_DAYS.past ||
      days > READING_RENEWAL_WINDOW_DAYS.future
    ) {
      drop("renewalDate", "That date doesn't fit a policy term, so I left it out.");
    }
  }

  if (
    fields.termMonths &&
    !(TERM_MONTHS as readonly number[]).includes(Number(fields.termMonths))
  ) {
    delete fields.termMonths;
    delete sources.termMonths;
  }
  if (fields.covers && fields.covers.length > MAX_COVERS_LENGTH) {
    fields.covers = fields.covers.slice(0, MAX_COVERS_LENGTH);
  }
  return { fields, sources, notes };
}

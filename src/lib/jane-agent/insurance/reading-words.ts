import { PREMIUM_FREQUENCIES } from "@/config/documents";
import { COVERAGE_FIELDS, POLICY_KINDS, isPolicyKind } from "@/config/insurance";
import { CoverageError, parseCoverage, valueWords } from "@/lib/insurance/coverage";
import { SOURCE_WORDS, flatten, type Fields } from "@/lib/insurance/reading-rules";
import type { Reading } from "@/lib/insurance/readings";
import { formatCents, parseMoneyToCents } from "@/lib/money";
import type { MessageAction } from "../types";

// A policy read from a document in Jane's chat (spec step 151): what it read, each field
// with where it came from, and what the rules left out, for one Confirm tap. Pure.

export const READING_LABELS: Record<string, string> = {
  carrier: "Insurer",
  kind: "Kind",
  premium: "Price",
  premiumFrequency: "How often you pay",
  deductible: "Deductible",
  renewalDate: "Renews on",
  covers: "What it covers",
};

const dateWords = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

// The kind as said in a sentence: "car", or "" for other.
export function kindWords(kind: string): string {
  return isPolicyKind(kind) && kind !== "other" ? POLICY_KINDS[kind].toLowerCase() : "";
}

const money = (text: string) => {
  const cents = parseMoneyToCents(text);
  return cents === null ? text : formatCents(cents);
};

// Pure: each field Jane has, said in words with where it came from, in the form's order.
export function readingLines(reading: Pick<Reading, "input" | "sources">): string[] {
  const fields: Fields = flatten(reading.input);
  const from = (key: string) => {
    const source = reading.sources[key];
    return source ? ` (${SOURCE_WORDS[source]})` : "";
  };
  const lines: string[] = [];
  if (fields.carrier) lines.push(`Insurer: ${fields.carrier}${from("carrier")}`);
  if (fields.premium) {
    const frequency = fields.premiumFrequency as keyof typeof PREMIUM_FREQUENCIES | undefined;
    const per = frequency ? ` ${PREMIUM_FREQUENCIES[frequency].label}` : "";
    lines.push(`Price: ${money(fields.premium)}${per}${from("premium")}`);
  }
  if (fields.deductible) lines.push(`Deductible: ${money(fields.deductible)}${from("deductible")}`);
  const kind = reading.input.kind;
  if (isPolicyKind(kind)) {
    for (const field of COVERAGE_FIELDS[kind]) {
      const text = fields[`coverage.${field.key}`];
      if (!text) continue;
      try {
        const value = parseCoverage(kind, { [field.key]: text })[field.key];
        if (value !== undefined) {
          lines.push(`${field.label}: ${valueWords(field, value)}${from(`coverage.${field.key}`)}`);
        }
      } catch (error) {
        if (!(error instanceof CoverageError)) throw error;
      }
    }
  }
  if (fields.renewalDate) {
    lines.push(`Renews on: ${dateWords(fields.renewalDate)}${from("renewalDate")}`);
  }
  return lines;
}

// Pure: what the rules said, as lines: "Deductible: It was higher than the cover limits…".
export function noteLines(reading: Pick<Reading, "input" | "notes">): string[] {
  const kind = reading.input.kind;
  return Object.entries(reading.notes).flatMap(([key, note]) => {
    if (key === "kind" && isPolicyKind(kind) && kind !== "other") return [];
    const coverage =
      key.startsWith("coverage.") && isPolicyKind(kind)
        ? COVERAGE_FIELDS[kind].find((f) => `coverage.${f.key}` === key)?.label
        : undefined;
    const label = coverage ?? READING_LABELS[key];
    return label ? [`${label}: ${note}`] : [];
  });
}

export function readingTitle(reading: Pick<Reading, "input" | "policyId">): string {
  const kind = kindWords(reading.input.kind);
  const policy = `${reading.input.carrier}${kind ? ` ${kind}` : ""} policy`;
  return reading.policyId ? `the renewal notice for your ${policy}` : `your ${policy}`;
}

export function readingBody(reading: Reading): string {
  const notes = noteLines(reading);
  return [
    `I read ${readingTitle(reading)}. Is this right?`,
    ...readingLines(reading).map((l) => `- ${l}`),
    ...(notes.length > 0 ? ["Worth a look:", ...notes.map((l) => `- ${l}`)] : []),
    reading.policyId
      ? "Nothing changes on your insurance until you confirm."
      : "Nothing is added to your insurance until you confirm.",
  ].join("\n");
}

// Pure: under each field on the page, where it came from and anything the rules said.
export function readingHints(reading: Pick<Reading, "sources" | "notes">): Record<string, string> {
  const hints: Record<string, string> = {};
  const keys = new Set([...Object.keys(reading.sources), ...Object.keys(reading.notes)]);
  for (const key of keys) {
    const source = reading.sources[key];
    const from = source ? SOURCE_WORDS[source] : null;
    const said = [from && `${from[0].toUpperCase()}${from.slice(1)}.`, reading.notes[key]];
    hints[key] = said.filter(Boolean).join(" ");
  }
  return hints;
}

export const readingLink = (id: string): MessageAction => ({
  id: "open",
  label: "Fix something",
  kind: "link",
  href: `/insurance/read/${id}`,
});

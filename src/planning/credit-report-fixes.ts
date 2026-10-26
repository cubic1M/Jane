import {
  BUREAU_INVESTIGATION_DAYS,
  CREDIT_RULES,
  MEDICAL_COLLECTION_FLOOR_CENTS,
  MEDICAL_COLLECTION_NOTE,
  VALIDATION_WINDOW_DAYS,
} from "@/config/credit-report-fixes";
import type { ReportItem } from "@/lib/credit/partner";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import { DAY_MS } from "@/lib/dates";

// Collections and credit report errors (spec step 181). Pure: the letters Jane drafts for an
// item on the person's report, each citing the right rule and giving the deadline from
// config, and the dates to track.

export const addDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

export type FixKind = "validation" | "dispute";

export type FixItem = {
  id: string;
  kind: FixKind;
  item: ReportItem;
  label: string;
  body: string;
  // When the rule gives the answer by if sent today, and for validation the last day to ask.
  answerByIfSentOn: (sentOn: string) => string;
  windowEndsOn: string | null;
};

const mark = (item: ReportItem) =>
  item.kind === "collection"
    ? `${item.creditor} (collecting for ${item.originalCreditor ?? "an original creditor"}), ${item.amountCents === null ? "an amount I don't recognise" : formatCents(item.amountCents)}`
    : `${item.creditor}: ${item.detail}`;

// The letters for one item. A collection gets a validation letter (to the collector) and a
// dispute (to the bureaus); an error gets a dispute.
export function fixItems(item: ReportItem, name: string): FixItem[] {
  const out: FixItem[] = [];
  const who = name || "[Your name]";
  if (item.kind === "collection") {
    const windowEndsOn = addDays(item.firstSeenOn, VALIDATION_WINDOW_DAYS);
    out.push({
      id: `validation:${item.id}`,
      kind: "validation",
      item,
      label: `Ask ${item.creditor} to validate the debt`,
      windowEndsOn,
      answerByIfSentOn: (sentOn) => addDays(sentOn, VALIDATION_WINDOW_DAYS),
      body: [
        `To ${item.creditor}:`,
        "",
        `I received your first notice about this account on ${dayLabel(item.firstSeenOn, { year: true })}: ${mark(item)}.`,
        CREDIT_RULES.validation.text,
        `The ${VALIDATION_WINDOW_DAYS} days to ask end on ${dayLabel(windowEndsOn, { year: true })}. Please also confirm in writing that you will not report this to the credit bureaus while it is disputed.`,
        "",
        `Sincerely,\n${who}`,
      ].join("\n"),
    });
  }
  out.push({
    id: `dispute:${item.id}`,
    kind: "dispute",
    item,
    label:
      item.kind === "collection"
        ? `Dispute the ${item.creditor} collection with the credit bureaus`
        : `Dispute the ${item.creditor} error with the credit bureaus`,
    windowEndsOn: null,
    answerByIfSentOn: (sentOn) => addDays(sentOn, BUREAU_INVESTIGATION_DAYS),
    body: [
      "To Equifax, Experian and TransUnion:",
      "",
      CREDIT_RULES.dispute.text,
      "",
      `Item: ${mark(item)}.`,
      item.kind === "error"
        ? `Why it's wrong: ${item.detail}`
        : item.medical && (item.amountCents ?? 0) < MEDICAL_COLLECTION_FLOOR_CENTS
          ? `This is a medical collection under ${formatCents(MEDICAL_COLLECTION_FLOOR_CENTS)}, which you don't report.`
          : item.medical
            ? "I am asking that it be investigated, and removed if it cannot be verified."
            : "I do not recognise this debt and ask that it be verified.",
      "",
      `Sincerely,\n${who}`,
    ].join("\n"),
  });
  return out;
}

export const medicalNote = (item: ReportItem) => (item.medical ? MEDICAL_COLLECTION_NOTE : null);

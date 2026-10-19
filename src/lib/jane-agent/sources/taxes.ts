import {
  TAX_ESTIMATE_STEP_CENTS,
  TAX_MESSAGE_PRIORITY,
  TAX_TAGS,
  type TaxTagKind,
} from "@/config/tax";
import { estimateMessage } from "../tax-replies";
import { formatCents } from "@/lib/money";
import { incomeLine, listOf } from "@/planning/tax-profile";
import { PROFILE_HREF, PROFILE_INTRO, TAGS_HREF, nextQuestion } from "../tax-flow";
import type { Candidate } from "../types";
import { shortDate, snoozeButton, type MessageSource } from "./source";

// Taxes (spec steps 118–127), what Jane brings up by herself:
// - Step 118: the tax profile, asked one question at a time in one message
//   (../tax-flow.ts); then, when she sees a kind of income that isn't on it, she asks
//   before adding it. Jane never adds anything to the profile by herself.
// - Step 119: a merchant she tagged but isn't sure about ("is MasterClass education?"),
//   once each; at the levels that let her act, what she tagged last month; and from late
//   January, each tax form that should have arrived, until the person has it.

const monthName = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    timeZone: "UTC",
  });

const tagPhrase = (tag: TaxTagKind, count: number, cents: number) =>
  `${TAX_TAGS[tag].plural} ${formatCents(cents)}${count > 1 ? ` (${count})` : ""}`;

export const taxesSource: MessageSource = {
  key: "taxes",
  gather(snapshot) {
    const tax = snapshot.tax;
    if (!tax) return [];
    const profile = tax.profile;
    const out: Candidate[] = [];

    // Only once Jane has something to work from (income in their accounts) or the person
    // has started on it themselves.
    const started =
      profile.incomeKinds.found.length > 0 ||
      (["incomeKinds", "filingStatus", "dependants", "state"] as const).some(
        (f) => profile[f].status === "yours",
      );
    const question = started ? nextQuestion(profile) : null;
    if (question) {
      out.push({
        kind: "decision",
        body: `${PROFILE_INTRO} ${question.body}`,
        refs: question.refs,
        actions: [...question.actions, snoozeButton()],
        dedupeKey: "profile",
        priority: TAX_MESSAGE_PRIORITY.profile,
      });
    }
    for (const found of profile.newIncome) {
      out.push({
        kind: "decision",
        body: `I've started seeing ${incomeLine(found)} in your accounts. It isn't on your tax profile yet. Add it?`,
        refs: { incomeKind: found.kind },
        actions: [
          { id: "tax.income_add", label: "Add it", kind: "primary" },
          { id: "tax.income_no", label: "Leave it off", kind: "secondary" },
          { id: "open", label: "See my tax profile", kind: "link", href: PROFILE_HREF },
        ],
        dedupeKey: `income:${found.kind}`,
        priority: TAX_MESSAGE_PRIORITY.new_income,
      });
    }

    for (const check of tax.tagChecks ?? []) {
      out.push({
        kind: "decision",
        body: `I've tagged ${check.payee} (${formatCents(check.totalCents)} this year) as ${TAX_TAGS[check.tag].label.toLowerCase()} for your taxes. Is that right?`,
        refs: { merchantKey: check.merchantKey, taxTag: check.tag },
        actions: [
          { id: "tax.tag_yes", label: "Yes, keep it", kind: "primary" },
          { id: "tax.tag_no", label: "No, not for taxes", kind: "secondary" },
          { id: "open", label: "See tax tags", kind: "link", href: TAGS_HREF },
        ],
        dedupeKey: `check:${check.merchantKey}`,
        priority: TAX_MESSAGE_PRIORITY.tag_check,
      });
    }

    const lastMonth = tax.lastMonth;
    const acts = ["safe", "all", "custom"].includes(snapshot.autopilot ?? "");
    if (acts && lastMonth && lastMonth.count > 0) {
      out.push({
        kind: "done",
        body: `In ${monthName(lastMonth.month)} I tagged ${lastMonth.count} ${lastMonth.count === 1 ? "thing" : "things"} for your taxes: ${listOf(lastMonth.byTag.map((b) => tagPhrase(b.tag, b.count, b.totalCents)))}. They're in your tax-time pack.`,
        refs: {},
        actions: [{ id: "open", label: "See tax tags", kind: "link", href: TAGS_HREF }],
        dedupeKey: `month:${lastMonth.month}`,
        priority: TAX_MESSAGE_PRIORITY.tag_month,
      });
    }

    // Spec step 120: the estimate, once there's income to estimate from; at the levels that
    // let Jane act, again whenever it moves by TAX_ESTIMATE_STEP_CENTS.
    const estimate = tax.estimate;
    if (estimate && estimate.estimate.totalIncomeCents > 0) {
      const balance = estimate.withholdingKnown
        ? estimate.estimate.refundCents
        : estimate.estimate.totalTaxCents;
      const step = Math.round(balance / TAX_ESTIMATE_STEP_CENTS);
      out.push({
        kind: "heads_up",
        ...estimateMessage(estimate),
        dedupeKey: acts ? `estimate:${estimate.year}:${step}` : `estimate:${estimate.year}`,
        priority: TAX_MESSAGE_PRIORITY.estimate,
      });
    }

    for (const form of tax.formsDue?.forms ?? []) {
      out.push({
        kind: "heads_up",
        body: `Your ${form.form} from ${form.from} for ${tax.formsDue!.year} is usually sent by ${shortDate(form.by)}. Have you got it?`,
        refs: { taxForm: form.key, taxYear: tax.formsDue!.year },
        actions: [
          { id: "tax.form_got", label: "I have it", kind: "primary" },
          snoozeButton("Not yet"),
          { id: "open", label: "See tax forms", kind: "link", href: "/taxes#forms" },
        ],
        dedupeKey: `form:${tax.formsDue!.year}:${form.key}`,
        priority: TAX_MESSAGE_PRIORITY.form_due,
      });
    }
    return out;
  },
};

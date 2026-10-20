import {
  TAX_ESTIMATE_STEP_CENTS,
  TAX_MESSAGE_PRIORITY,
  TAX_TAGS,
  type TaxTagKind,
} from "@/config/tax";
import { estimateMessage } from "../tax-replies";
import { w4Suggestion, withholdingFacts } from "../tax-w4";
import { savingMessage } from "../tax-saving-message";
import { nextQuarter, quarterMessage, setAsideMessage } from "../tax-self-employed";
import { refundMessage } from "../tax-refund-message";
import { filingAccepted, filingOffer, filingReady } from "../tax-filing-message";
import { januaryMessage } from "../tax-january";
import { harvestMessage, washSaleMessage } from "../tax-investments";
import { localityMessage, movingEventMessage, spottedMoveMessage } from "../tax-states-message";
import { collectedMessage, flaggedMessage, missingMessage } from "../tax-documents-message";
import { planMoveMessage } from "../tax-plan-message";
import { givingOptionsMessage, receiptMessage } from "../giving-message";
import { familyChoiceMessage, statusOf } from "../family-taxes-message";
import { worthSaying } from "@/planning/family-taxes";
import { equitySetAsideMessage } from "../equity-tax-message";
import { yearsMoveMessage } from "../multi-year-message";
import {
  appealDraftedMessage,
  appealSuggestedMessage,
  exemptionMessage,
} from "../property-tax-message";
import { caseMessage, ipPinMessage, signMessage } from "../tax-identity-message";
import {
  noticeDraftMessage,
  noticeOpenMessage,
  noticeReadingMessage,
  remindDays,
} from "../tax-notice-message";
import { hobbyMessage, rentalSetupMessage } from "../side-income-message";
import { readingMessage, reviewMessage } from "../prior-return-message";
import { retentionMessage } from "../audit-records-message";
import { homeSaleMessage, saltCapMessage } from "../home-taxes-message";
import { HARVEST_FROM } from "@/config/tax";
import { formatCents } from "@/lib/money";
import { incomeLine, listOf } from "@/planning/tax-profile";
import { PROFILE_HREF, PROFILE_INTRO, TAGS_HREF, nextQuestion } from "../tax-flow";
import type { Candidate } from "../types";
import { shortDate, snoozeButton, type MessageSource } from "./source";

// Taxes (spec steps 118–127), what Jane brings up by herself:
// - Step 118: the tax profile, asked one question at a time in one message
//   (../tax-flow.ts); then, when she sees a kind of income that isn't on it, she asks
//   before adding it. Jane never adds anything to the profile by herself.
// - Step 165: a move she spotted, or one on the checklist, and the city income tax question.
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
  gather(snapshot, context) {
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

    // Spec step 165: a move Jane spotted in payments to state agencies (at the levels that
    // let her act, already counted), or one started on the checklist; then, living in a
    // state with city income taxes, whether the person lives in one.
    const residency = estimate?.residency;
    if (estimate && residency && !residency.told) {
      const spotted = spottedMoveMessage(residency);
      if (spotted) {
        out.push({
          kind: "decision",
          ...spotted,
          dedupeKey: `move:${residency.year}:${residency.spotted!.date}`,
          priority: TAX_MESSAGE_PRIORITY.move,
        });
      } else if (residency.movingEvent) {
        out.push({
          kind: "decision",
          ...movingEventMessage(residency, estimate.input.state),
          dedupeKey: `moving:${residency.year}`,
          priority: TAX_MESSAGE_PRIORITY.move,
        });
      }
    }
    const home = estimate?.estimate.state;
    if (
      estimate &&
      home &&
      residency?.locality === null &&
      estimate.estimate.totalIncomeCents > 0
    ) {
      const local = localityMessage(home.code);
      if (local) {
        out.push({
          kind: "decision",
          ...local,
          dedupeKey: `local:${home.code}`,
          priority: TAX_MESSAGE_PRIORITY.local,
        });
      }
    }

    // Spec step 121: a big refund or a bill coming. In demo advice mode, what to put on a
    // new W-4 and a walk-through; otherwise the comparison and the IRS's estimator. Not once
    // the person sent a W-4 this year, or said they'd keep a big refund.
    const check = tax.withholding;
    if (
      estimate &&
      check &&
      (check.status === "big_refund" || check.status === "bill_coming") &&
      !estimate.w4 &&
      !(check.status === "big_refund" && estimate.keepRefundYear === estimate.year)
    ) {
      const message = tax.advice
        ? w4Suggestion(estimate, check)
        : withholdingFacts(estimate, check);
      out.push({
        kind: tax.advice ? "decision" : "heads_up",
        ...message,
        dedupeKey: `withholding:${estimate.year}:${check.status}`,
        priority: TAX_MESSAGE_PRIORITY.withholding,
      });
    }

    // Spec step 122: ways to pay less, biggest first, once each a year (demo advice only:
    // the list is empty otherwise).
    if (estimate && tax.advice) {
      for (const saving of tax.savings ?? []) {
        out.push({
          kind: "decision",
          ...savingMessage(saving, estimate.year),
          dedupeKey: `saving:${estimate.year}:${saving.key}`,
          priority: TAX_MESSAGE_PRIORITY.saving,
        });
      }
    }

    // Spec step 123: freelancers, in demo advice mode: the next estimated payment with its
    // amount, before it's due; and what to set aside from each new payment.
    const self = tax.selfEmployed;
    if (self && self.advice && self.active) {
      const q = nextQuarter(self, context.local.date);
      if (q) {
        out.push({
          kind: "heads_up",
          ...quarterMessage(self, q),
          dedupeKey: `quarter:${q.date}`,
          priority: TAX_MESSAGE_PRIORITY.quarterly,
        });
      }
      if (self.setAsideRate > 0) {
        for (const payment of self.recent) {
          out.push({
            kind: "heads_up",
            ...setAsideMessage(self, payment),
            dedupeKey: `setaside:${payment.id}`,
            priority: TAX_MESSAGE_PRIORITY.set_aside,
          });
        }
      }
    }

    // Spec step 125: a refund that landed, matched to the estimate; in demo advice mode with
    // a plan for it, set up with one tap.
    if (tax.refund) {
      const message = refundMessage(tax.refund);
      out.push({
        kind: message.refs.advice ? "decision" : "heads_up",
        ...message,
        dedupeKey: `refund:${tax.refund.refund.transactionId}`,
        priority: TAX_MESSAGE_PRIORITY.refund,
      });
    }

    // Spec step 124: investments. A wash sale, for everyone; in demo advice mode, a loss
    // worth harvesting (from October to the year's end). Where to hold what is said by the
    // investments lane (step 135).
    const inv = tax.investments;
    if (inv) {
      for (const sale of inv.washSales) {
        out.push({
          kind: "heads_up",
          ...washSaleMessage(sale),
          dedupeKey: `wash:${sale.securityId}:${sale.date}`,
          priority: TAX_MESSAGE_PRIORITY.wash_sale,
        });
      }
      if (tax.advice && estimate) {
        const today = context.local.date;
        if (today.slice(5) >= HARVEST_FROM && today.startsWith(String(estimate.year))) {
          for (const chance of inv.harvest.slice(0, 1)) {
            out.push({
              kind: "decision",
              ...harvestMessage(chance, estimate),
              dedupeKey: `harvest:${estimate.year}:${chance.holding.securityId}`,
              priority: TAX_MESSAGE_PRIORITY.harvest,
            });
          }
        }
      }
    }

    // Spec step 127: in January, one message with last year's taxes ready.
    if (tax.january) {
      out.push({
        kind: "heads_up",
        ...januaryMessage(tax.january, tax.estimate ?? null),
        dedupeKey: `january:${tax.january.year}`,
        priority: TAX_MESSAGE_PRIORITY.january,
      });
    }

    // Spec step 126: filing. In filing season, the offer to start; then the return ready to
    // review (signed on the page only); then accepted.
    const filing = tax.filing;
    if (filing?.available) {
      const ret = filing.return;
      if (!ret && filing.inSeason) {
        out.push({
          kind: "decision",
          ...filingOffer(filing.year, profile, tax.formsDue?.forms.length ?? 0),
          dedupeKey: `file:${filing.year}`,
          priority: TAX_MESSAGE_PRIORITY.filing,
        });
      } else if (ret?.status === "ready_for_review") {
        out.push({
          kind: "heads_up",
          ...filingReady(ret),
          dedupeKey: `review:${ret.year}`,
          priority: TAX_MESSAGE_PRIORITY.filing,
        });
      } else if (ret?.status === "accepted") {
        out.push({
          kind: "done",
          ...filingAccepted(ret),
          dedupeKey: `accepted:${ret.year}`,
          priority: TAX_MESSAGE_PRIORITY.filing,
        });
      }
    }

    // Spec step 167: each tax move open now, once (moves with their own message, like the
    // quarterly payment and filing, aren't posted again). At the levels that let Jane act
    // it's already on the deadlines; otherwise one tap puts it there.
    for (const m of tax.plan?.moves ?? []) {
      if (!m.open || m.ownMessage || m.handled === "no") continue;
      // Jane adds open moves herself at the levels that let her act (then says so); at the
      // others the person adds them, so there's nothing more to say.
      if ((m.handled === null) === acts) continue;
      out.push({
        kind: m.handled === "added" ? "done" : "decision",
        ...planMoveMessage(m),
        dedupeKey: `plan:${m.id}`,
        priority: TAX_MESSAGE_PRIORITY.plan,
      });
    }

    // Spec step 168: each gift that needs the charity's receipt, once; in demo advice mode
    // and before the year ends, the giving options (unless said no to this year).
    const giving = tax.giving;
    if (giving) {
      for (const g of giving.receiptsMissing) {
        out.push({
          kind: "heads_up",
          ...receiptMessage(g),
          dedupeKey: `receipt:${g.transactionId}`,
          priority: TAX_MESSAGE_PRIORITY.receipt,
        });
      }
      const options = giving.inSeason && !giving.dismissed ? givingOptionsMessage(giving) : null;
      if (options) {
        out.push({
          kind: "decision",
          ...options,
          dedupeKey: `giving:${giving.year}`,
          priority: TAX_MESSAGE_PRIORITY.giving,
        });
      }
    }

    // Spec step 169: a family tax choice where one side saves enough, once a year (demo
    // advice). Filing status only when the better side isn't the one on the profile.
    const family = tax.family;
    for (const c of family?.choices ?? []) {
      // Claiming one's own children is no choice to bring up; it's on the page and in answers.
      if (!worthSaying(c) || c.key === "children") continue;
      if (
        c.key === "filing" &&
        statusOf(c.sides[c.better!].label) === estimate?.input.filingStatus
      ) {
        continue;
      }
      out.push({
        kind: c.key === "filing" ? "decision" : "heads_up",
        ...familyChoiceMessage(c, family!.year),
        dedupeKey: `family:${family!.year}:${c.key}`,
        priority: TAX_MESSAGE_PRIORITY.family,
      });
    }

    // Spec step 219: crypto and equity pay add tax nothing withholds: what to set aside, with
    // its goal (demo advice).
    const equity = tax.equity;
    if (equity?.advice && equity.setAside.cents >= 20_000 && !equity.setAside.goalStarted) {
      out.push({
        kind: "decision",
        ...equitySetAsideMessage(equity),
        dedupeKey: `equity:${equity.year}:${Math.round(equity.setAside.cents / 100_000)}`,
        priority: TAX_MESSAGE_PRIORITY.equity,
      });
    }

    // Spec step 220: the move that saves the most over the years (demo advice).
    const years = tax.years;
    const move = years?.advice ? years.moves[0] : undefined;
    if (years && move) {
      out.push({
        kind: "decision",
        ...yearsMoveMessage(years, move),
        dedupeKey: `years:${move.key}`,
        priority: TAX_MESSAGE_PRIORITY.years,
      });
    }

    // Spec step 221: an assessment worth appealing, the drafted appeal waiting for a filer,
    // and an exemption not yet claimed (demo advice).
    const property = tax.property;
    if (property?.advice) {
      if (property.appeal?.status === "drafted") {
        out.push({
          kind: "decision",
          ...appealDraftedMessage(property),
          dedupeKey: `property_filer:${property.year}`,
          priority: TAX_MESSAGE_PRIORITY.property,
        });
      } else if (property.suggested && !property.appeal) {
        out.push({
          kind: "decision",
          ...appealSuggestedMessage(property),
          dedupeKey: `property:${property.year}`,
          priority: TAX_MESSAGE_PRIORITY.property,
        });
      }
      const exemption = exemptionMessage(property);
      if (exemption) {
        out.push({
          kind: "decision",
          ...exemption,
          dedupeKey: `exemption:${exemption.refs.propertyExemption}`,
          priority: TAX_MESSAGE_PRIORITY.exemption,
        });
      }
    }

    // Spec step 218: the IP PIN in January (already on the deadlines at the levels that let
    // Jane act); a sign of identity theft she noticed; and an open case's next step.
    const identity = tax.identity;
    if (identity) {
      if (identity.season && !identity.havePin) {
        out.push({
          kind: acts && identity.reminded ? "done" : "decision",
          ...ipPinMessage(identity, acts && identity.reminded),
          dedupeKey: `ippin:${identity.year}`,
          priority: TAX_MESSAGE_PRIORITY.ip_pin,
        });
      }
      for (const c of identity.candidates) {
        out.push({
          kind: "decision",
          ...signMessage(c),
          dedupeKey: `identity-sign:${c.key}`,
          priority: TAX_MESSAGE_PRIORITY.identity,
        });
      }
      const step = caseMessage(identity);
      if (step) {
        out.push({
          kind: "decision",
          ...step,
          dedupeKey: `identity-step:${identity.case!.id}:${identity.case!.next}`,
          priority: TAX_MESSAGE_PRIORITY.identity,
        });
      }
    }

    // Spec step 217: tax notices. Urgent: a notice to confirm, then one to answer (again
    // as the date nears), then the draft to hand over.
    for (const { notice: n, check } of tax.notices ?? []) {
      if (n.status === "waiting") {
        out.push({
          kind: "decision",
          ...noticeReadingMessage(n),
          dedupeKey: `notice:${n.id}`,
          priority: TAX_MESSAGE_PRIORITY.notice,
        });
      } else if (n.status === "confirmed" && !n.handledBy) {
        if (n.draft) {
          out.push({
            kind: "decision",
            ...noticeDraftMessage(n),
            dedupeKey: `notice-draft:${n.id}:${n.response}`,
            priority: TAX_MESSAGE_PRIORITY.notice,
          });
        } else if (check) {
          out.push({
            kind: "decision",
            ...noticeOpenMessage(n, check, context.local.date),
            dedupeKey: `notice-open:${n.id}:${remindDays(n, context.local.date) ?? 0}`,
            priority: TAX_MESSAGE_PRIORITY.notice,
          });
        }
      }
    }

    // Spec step 173: a rental that needs its property for depreciation; hobby or business
    // (demo advice, with both taxes shown).
    if (tax.sideIncome) {
      const setup = rentalSetupMessage(tax.sideIncome);
      if (setup) {
        out.push({
          kind: "heads_up",
          ...setup,
          dedupeKey: `rental:${tax.sideIncome.year}`,
          priority: TAX_MESSAGE_PRIORITY.rental_setup,
        });
      }
      const kind = tax.advice ? hobbyMessage(tax.sideIncome) : null;
      if (kind) {
        out.push({
          kind: "decision",
          ...kind,
          dedupeKey: `sidekind:${tax.sideIncome.year}`,
          priority: TAX_MESSAGE_PRIORITY.side_kind,
        });
      }
    }

    // Spec step 172: a return Jane read, to confirm; and what its review found.
    for (const r of tax.priorReturns ?? []) {
      out.push({
        kind: "decision",
        ...readingMessage(r),
        dedupeKey: `prior:${r.id}`,
        priority: TAX_MESSAGE_PRIORITY.prior_return,
      });
    }
    for (const r of tax.returnReviews ?? []) {
      if (!r.worthAmending && !r.amendment) continue;
      out.push({
        kind: "decision",
        ...reviewMessage(r),
        dedupeKey: `review-return:${r.year}:${r.amendment?.status ?? "open"}`,
        priority: TAX_MESSAGE_PRIORITY.prior_review,
      });
    }

    // Spec step 171: a year's records that can be thrown away soon (the reminder is on the
    // deadlines already at the levels that let Jane act).
    if (!acts) {
      for (const r of tax.records?.due ?? []) {
        out.push({
          kind: "heads_up",
          ...retentionMessage(r),
          dedupeKey: `records:${r.year}`,
          priority: TAX_MESSAGE_PRIORITY.records,
        });
      }
    }

    // Spec step 170: the state and local tax cap biting once property tax is paid, and a
    // home sale against the exclusion, once each a year.
    const homeTax = tax.home;
    if (homeTax) {
      const cap = saltCapMessage(homeTax);
      if (cap) {
        out.push({
          kind: "heads_up",
          ...cap,
          dedupeKey: `salt:${homeTax.year}`,
          priority: TAX_MESSAGE_PRIORITY.salt_cap,
        });
      }
      const sale = homeSaleMessage(homeTax);
      if (sale) {
        out.push({
          kind: "heads_up",
          ...sale,
          dedupeKey: `homesale:${homeTax.year}:${homeTax.sale!.sale.cents}`,
          priority: TAX_MESSAGE_PRIORITY.home_sale,
        });
      }
    }

    // Spec step 166: with a document partner, Jane collects the forms herself: a form that
    // doesn't match the accounts, the ones collected, and one still missing a week after its
    // date. Without one, she asks whether each has arrived (below).
    const docs = tax.documents;
    if (docs?.collecting) {
      for (const f of docs.flagged) {
        out.push({
          kind: "decision",
          ...flaggedMessage(f, docs.year),
          dedupeKey: `doc:${docs.year}:${f.key}:differs`,
          priority: TAX_MESSAGE_PRIORITY.doc_flagged,
        });
      }
      const collected = collectedMessage(docs, acts);
      if (collected) {
        const n = docs.forms.filter((f) => f.document && f.usable).length;
        out.push({
          kind: collected.actions.some((a) => a.id === "tax.docs_tick") ? "decision" : "done",
          ...collected,
          dedupeKey: `docs:${docs.year}:${n}`,
          priority: TAX_MESSAGE_PRIORITY.doc_collected,
        });
      }
      for (const f of docs.missing) {
        out.push({
          kind: "heads_up",
          ...missingMessage(f, docs.year),
          dedupeKey: `docmissing:${docs.year}:${f.key}`,
          priority: TAX_MESSAGE_PRIORITY.doc_missing,
        });
      }
    }
    for (const form of docs?.collecting ? [] : (tax.formsDue?.forms ?? [])) {
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

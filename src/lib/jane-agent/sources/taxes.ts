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
import { answersMessage, complexMessage } from "../accountant-message";
import { estimateDueMessage, yearEndMessage } from "../tax-calendar-message";
import { sCorpMessage } from "../business-message";
import { giftsMessage, inheritedIraMessage } from "../inheritance-message";
import { hsaMessage, medicalMessage, repaymentMessage } from "../health-tax-message";
import { reliefMessage } from "../disaster-message";
import { irmaaMessage, ssWithholdingMessage } from "../retirement-tax-message";
import { draftFindingMessage, draftReadingMessage } from "../draft-return-message";
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
import { type Candidate, type MessageKind, openLink } from "../types";
import type { Snapshot } from "../snapshot";
import { snoozeButton, type MessageSource, type SourceContext } from "./source";
import { dayLabel, monthLabel } from "@/lib/day-label";

// Taxes (spec steps 118–127), what Jane brings up on its own:
// - Step 118: the tax profile, asked one question at a time in one message
//   (../tax-flow.ts); then, when it sees a kind of income that isn't on it, it asks
//   before adding it. Jane never adds anything to the profile on its own.
// - Step 165: a move it spotted, or one on the checklist, and the city income tax question.
// - Step 119: a merchant it tagged but isn't sure about ("is MasterClass education?"),
//   once each; at the levels that let it act, what it tagged last month; and from late
//   January, each tax form that should have arrived, until the person has it.

const tagPhrase = (tag: TaxTagKind, count: number, cents: number) =>
  `${TAX_TAGS[tag].plural} ${formatCents(cents)}${count > 1 ? ` (${count})` : ""}`;

const P = TAX_MESSAGE_PRIORITY;

// One card: a message (body, refs, actions) with its kind, key and priority.
type Message = Omit<Candidate, "kind" | "dedupeKey" | "priority">;
const card = (
  kind: MessageKind,
  message: Message,
  dedupeKey: string,
  priority: number,
): Candidate => ({ kind, ...message, dedupeKey, priority });

// What each topic reads. acts: the levels that let Jane act on its own.
type Tax = NonNullable<Snapshot["tax"]>;
type In = { tax: Tax; snapshot: Snapshot; context: SourceContext; acts: boolean };

// The tax profile (step 118), asked only once Jane has something to work from (income in their
// accounts) or the person has started on it themselves; then each new kind of income.
function profileCards({ tax }: In): Candidate[] {
  const profile = tax.profile;
  const started =
    profile.incomeKinds.found.length > 0 ||
    (["incomeKinds", "filingStatus", "dependants", "state"] as const).some(
      (f) => profile[f].status === "yours",
    );
  const question = started ? nextQuestion(profile) : null;
  return [
    ...(question
      ? [
          card(
            "decision",
            {
              body: `${PROFILE_INTRO} ${question.body}`,
              refs: question.refs,
              actions: [...question.actions, snoozeButton()],
            },
            "profile",
            P.profile,
          ),
        ]
      : []),
    ...profile.newIncome.map((found) =>
      card(
        "decision",
        {
          body: `I've started seeing ${incomeLine(found)} in your accounts. It isn't on your tax profile yet. Add it?`,
          refs: { incomeKind: found.kind },
          actions: [
            { id: "tax.income_add", label: "Add it", kind: "primary" },
            { id: "tax.income_no", label: "Leave it off", kind: "secondary" },
            openLink("See my tax profile", PROFILE_HREF),
          ],
        },
        `income:${found.kind}`,
        P.new_income,
      ),
    ),
  ];
}

// Step 119: each merchant Jane tagged but isn't sure about; at the levels that let it act,
// what it tagged last month.
function tagCards({ tax, acts }: In): Candidate[] {
  const out = (tax.tagChecks ?? []).map((check) =>
    card(
      "decision",
      {
        body: `I've tagged ${check.payee} (${formatCents(check.totalCents)} this year) as ${TAX_TAGS[check.tag].label.toLowerCase()} for your taxes. Is that right?`,
        refs: { merchantKey: check.merchantKey, taxTag: check.tag },
        actions: [
          { id: "tax.tag_yes", label: "Yes, keep it", kind: "primary" },
          { id: "tax.tag_no", label: "No, not for taxes", kind: "secondary" },
          openLink("See tax tags", TAGS_HREF),
        ],
      },
      `check:${check.merchantKey}`,
      P.tag_check,
    ),
  );
  const lastMonth = tax.lastMonth;
  if (acts && lastMonth && lastMonth.count > 0) {
    out.push(
      card(
        "done",
        {
          body: `In ${monthLabel(lastMonth.month, { long: true, year: false })} I tagged ${lastMonth.count} ${lastMonth.count === 1 ? "thing" : "things"} for your taxes: ${listOf(lastMonth.byTag.map((b) => tagPhrase(b.tag, b.count, b.totalCents)))}. They're in your tax-time pack.`,
          refs: {},
          actions: [openLink("See tax tags", TAGS_HREF)],
        },
        `month:${lastMonth.month}`,
        P.tag_month,
      ),
    );
  }
  return out;
}

// Spec step 120: the estimate, once there's income to estimate from; at the levels that
// let Jane act, again whenever it moves by TAX_ESTIMATE_STEP_CENTS.
function estimateCards({ tax, acts }: In): Candidate[] {
  const estimate = tax.estimate;
  if (!estimate || !(estimate.estimate.totalIncomeCents > 0)) return [];
  const balance = estimate.withholdingKnown
    ? estimate.estimate.refundCents
    : estimate.estimate.totalTaxCents;
  const step = Math.round(balance / TAX_ESTIMATE_STEP_CENTS);
  return [
    card(
      "heads_up",
      estimateMessage(estimate),
      acts ? `estimate:${estimate.year}:${step}` : `estimate:${estimate.year}`,
      P.estimate,
    ),
  ];
}

// Spec step 165: a move Jane spotted in payments to state agencies (at the levels that
// let it act, already counted), or one started on the checklist; then, living in a
// state with city income taxes, whether the person lives in one.
function residencyCards({ tax }: In): Candidate[] {
  const out: Candidate[] = [];
  const estimate = tax.estimate;
  const residency = estimate?.residency;
  if (estimate && residency && !residency.told) {
    const spotted = spottedMoveMessage(residency);
    if (spotted) {
      out.push(
        card("decision", spotted, `move:${residency.year}:${residency.spotted!.date}`, P.move),
      );
    } else if (residency.movingEvent) {
      out.push(
        card(
          "decision",
          movingEventMessage(residency, estimate.input.state),
          `moving:${residency.year}`,
          P.move,
        ),
      );
    }
  }
  const home = estimate?.estimate.state;
  if (estimate && home && residency?.locality === null && estimate.estimate.totalIncomeCents > 0) {
    const local = localityMessage(home.code);
    if (local) out.push(card("decision", local, `local:${home.code}`, P.local));
  }
  return out;
}

// Spec step 121: a big refund or a bill coming. In demo advice mode, what to put on a
// new W-4 and a walk-through; otherwise the comparison and the IRS's estimator. Not once
// the person sent a W-4 this year, or said they'd keep a big refund.
function withholdingCards({ tax }: In): Candidate[] {
  const estimate = tax.estimate;
  const check = tax.withholding;
  if (
    !estimate ||
    !check ||
    !(check.status === "big_refund" || check.status === "bill_coming") ||
    estimate.w4 ||
    (check.status === "big_refund" && estimate.keepRefundYear === estimate.year)
  ) {
    return [];
  }
  const message = tax.advice ? w4Suggestion(estimate, check) : withholdingFacts(estimate, check);
  return [
    card(
      tax.advice ? "decision" : "heads_up",
      message,
      `withholding:${estimate.year}:${check.status}`,
      P.withholding,
    ),
  ];
}

// Spec step 122: ways to pay less, biggest first, once each a year (demo advice only:
// the list is empty otherwise).
function savingCards({ tax }: In): Candidate[] {
  const estimate = tax.estimate;
  if (!estimate || !tax.advice) return [];
  return (tax.savings ?? []).map((saving) =>
    card(
      "decision",
      savingMessage(saving, estimate.year),
      `saving:${estimate.year}:${saving.key}`,
      P.saving,
    ),
  );
}

// Spec step 123: freelancers, in demo advice mode: the next estimated payment with its
// amount, before it's due; and what to set aside from each new payment.
function selfEmployedCards({ tax, context }: In): Candidate[] {
  const self = tax.selfEmployed;
  if (!self || !self.advice || !self.active) return [];
  const out: Candidate[] = [];
  const q = nextQuarter(self, context.local.date);
  if (q) out.push(card("heads_up", quarterMessage(self, q), `quarter:${q.date}`, P.quarterly));
  if (self.setAsideRate > 0) {
    for (const payment of self.recent) {
      out.push(
        card("heads_up", setAsideMessage(self, payment), `setaside:${payment.id}`, P.set_aside),
      );
    }
  }
  return out;
}

// Spec step 125: a refund that landed, matched to the estimate; in demo advice mode with
// a plan for it, set up with one tap.
function refundCards({ tax }: In): Candidate[] {
  if (!tax.refund) return [];
  const message = refundMessage(tax.refund);
  return [
    card(
      message.refs.advice ? "decision" : "heads_up",
      message,
      `refund:${tax.refund.refund.transactionId}`,
      P.refund,
    ),
  ];
}

// Spec step 124: investments. A wash sale, for everyone; in demo advice mode, a loss
// worth harvesting (from October to the year's end). Where to hold what is said by the
// investments lane (step 135).
function investmentCards({ tax, context }: In): Candidate[] {
  const inv = tax.investments;
  if (!inv) return [];
  const out = inv.washSales.map((sale) =>
    card("heads_up", washSaleMessage(sale), `wash:${sale.securityId}:${sale.date}`, P.wash_sale),
  );
  const estimate = tax.estimate;
  const today = context.local.date;
  if (
    tax.advice &&
    estimate &&
    today.slice(5) >= HARVEST_FROM &&
    today.startsWith(String(estimate.year))
  ) {
    // It's also the tax plan's "Sell at a loss" move, which posts nothing of its own
    // (ownMessage): said no to there, it isn't said here; put on the deadlines (by Jane or
    // the person), this says so instead of offering to remind.
    const move = tax.plan?.moves.find((m) => m.key === "harvest");
    for (const chance of move?.handled === "no" ? [] : inv.harvest.slice(0, 1)) {
      const message = harvestMessage(chance, estimate);
      const added = move?.handled === "added";
      out.push(
        card(
          added ? "heads_up" : "decision",
          added
            ? {
                ...message,
                body: `${message.body} It's on your deadlines.`,
                actions: message.actions.filter((a) => a.id !== "tax.save_task"),
              }
            : message,
          `harvest:${estimate.year}:${chance.holding.securityId}`,
          P.harvest,
        ),
      );
    }
  }
  return out;
}

// Spec step 127: in January, one message with last year's taxes ready.
function januaryCards({ tax }: In): Candidate[] {
  if (!tax.january) return [];
  return [
    card(
      "heads_up",
      januaryMessage(tax.january, tax.estimate ?? null),
      `january:${tax.january.year}`,
      P.january,
    ),
  ];
}

// Spec step 126: filing. In filing season, the offer to start; then the return ready to
// review (signed on the page only); then accepted.
function filingCards({ tax }: In): Candidate[] {
  const filing = tax.filing;
  if (!filing?.available) return [];
  const ret = filing.return;
  if (!ret && filing.inSeason) {
    return [
      card(
        "decision",
        filingOffer(filing.year, tax.profile, tax.formsDue?.forms.length ?? 0),
        `file:${filing.year}`,
        P.filing,
      ),
    ];
  }
  if (ret?.status === "ready_for_review") {
    return [card("heads_up", filingReady(ret), `review:${ret.year}`, P.filing)];
  }
  if (ret?.status === "accepted") {
    return [card("done", filingAccepted(ret), `accepted:${ret.year}`, P.filing)];
  }
  return [];
}

// Spec step 167: each tax move open now, once (moves with their own message, like the
// quarterly payment and filing, aren't posted again). At the levels that let Jane act
// it's already on the deadlines; otherwise one tap puts it there.
function planCards({ tax, acts }: In): Candidate[] {
  return (
    (tax.plan?.moves ?? [])
      .filter((m) => m.open && !m.ownMessage && m.handled !== "no")
      // Jane adds open moves itself at the levels that let it act (then says so); at the
      // others the person adds them, so there's nothing more to say.
      .filter((m) => (m.handled === null) !== acts)
      .map((m) =>
        card(
          m.handled === "added" ? "done" : "decision",
          planMoveMessage(m),
          `plan:${m.id}`,
          P.plan,
        ),
      )
  );
}

// Spec step 168: each gift that needs the charity's receipt, once; in demo advice mode
// and before the year ends, the giving options (unless said no to this year).
function givingCards({ tax }: In): Candidate[] {
  const giving = tax.giving;
  if (!giving) return [];
  const out = giving.receiptsMissing.map((g) =>
    card("heads_up", receiptMessage(g), `receipt:${g.transactionId}`, P.receipt),
  );
  const options = giving.inSeason && !giving.dismissed ? givingOptionsMessage(giving) : null;
  if (options) out.push(card("decision", options, `giving:${giving.year}`, P.giving));
  return out;
}

// Spec step 169: a family tax choice where one side saves enough, once a year (demo
// advice). Filing status only when the better side isn't the one on the profile.
function familyCards({ tax }: In): Candidate[] {
  const family = tax.family;
  if (!family) return [];
  return (
    family.choices
      // Claiming one's own children is no choice to bring up; it's on the page and in answers.
      .filter((c) => worthSaying(c) && c.key !== "children")
      .filter(
        (c) =>
          c.key !== "filing" ||
          statusOf(c.sides[c.better!].label) !== tax.estimate?.input.filingStatus,
      )
      .map((c) =>
        card(
          c.key === "filing" ? "decision" : "heads_up",
          familyChoiceMessage(c, family.year),
          `family:${family.year}:${c.key}`,
          P.family,
        ),
      )
  );
}

// Spec step 219: crypto and equity pay add tax nothing withholds: what to set aside, with
// its goal (demo advice).
function equityCards({ tax }: In): Candidate[] {
  const equity = tax.equity;
  if (!equity?.advice || !(equity.setAside.cents >= 20_000) || equity.setAside.goalStarted)
    return [];
  return [
    card(
      "decision",
      equitySetAsideMessage(equity),
      `equity:${equity.year}:${Math.round(equity.setAside.cents / 100_000)}`,
      P.equity,
    ),
  ];
}

// Spec step 220: the move that saves the most over the years (demo advice).
function yearsCards({ tax }: In): Candidate[] {
  const years = tax.years;
  const move = years?.advice ? years.moves[0] : undefined;
  if (!years || !move) return [];
  return [card("decision", yearsMoveMessage(years, move), `years:${move.key}`, P.years)];
}

// Spec step 221: an assessment worth appealing, the drafted appeal waiting for a filer,
// and an exemption not yet claimed (demo advice).
function propertyCards({ tax }: In): Candidate[] {
  const property = tax.property;
  if (!property?.advice) return [];
  const out: Candidate[] = [];
  if (property.appeal?.status === "drafted") {
    out.push(
      card(
        "decision",
        appealDraftedMessage(property),
        `property_filer:${property.year}`,
        P.property,
      ),
    );
  } else if (property.suggested && !property.appeal) {
    out.push(
      card("decision", appealSuggestedMessage(property), `property:${property.year}`, P.property),
    );
  }
  const exemption = exemptionMessage(property);
  if (exemption) {
    out.push(
      card("decision", exemption, `exemption:${exemption.refs.propertyExemption}`, P.exemption),
    );
  }
  return out;
}

// Spec step 222: what the accountant wrote back, and a return people usually bring an
// accountant to (once a year, only while there is no live link).
function accountantCards({ tax }: In): Candidate[] {
  const accountant = tax.accountant;
  if (!accountant) return [];
  const out: Candidate[] = [];
  const answers = answersMessage(accountant);
  if (answers) {
    out.push(
      card(
        "decision",
        answers,
        `accountant_answer:${accountant.notes.filter((n) => !n.seen).length}:${accountant.notes[0]?.id}`,
        P.accountant_answer,
      ),
    );
  }
  const complex = accountant.activeCount === 0 ? complexMessage(accountant) : null;
  if (complex) out.push(card("decision", complex, `accountant:${accountant.year}`, P.accountant));
  return out;
}

// Spec step 223: an estimated payment that needs the person's tap, and December's
// year-end moves in one message.
function calendarCards({ tax }: In): Candidate[] {
  const calendar = tax.calendar;
  if (!calendar) return [];
  const out = calendar.due
    .filter((x) => x.needsTap && x.needsTap !== "no_partner")
    .map((d) =>
      card(
        "decision",
        estimateDueMessage(d, calendar.year),
        `estimate_due:${d.dueOn}`,
        P.estimate_due,
      ),
    );
  if (calendar.yearEnd && calendar.advice) {
    out.push(
      card(
        "decision",
        yearEndMessage(calendar.yearEnd, calendar.acts),
        `yearend:${calendar.yearEnd.year}`,
        P.year_end,
      ),
    );
  }
  return out;
}

// Spec step 267: an S corporation that would save more than it costs (demo advice).
function businessCards({ tax }: In): Candidate[] {
  const business = tax.business ? sCorpMessage(tax.business) : null;
  if (!tax.business || !business) return [];
  return [card("decision", business, `business:${tax.business.year}`, P.business)];
}

// Spec step 268: an inherited IRA's deadline and spread (demo advice), and gifts over the
// annual exclusion (facts, with a pointer to a tax professional).
function inheritanceCards({ tax }: In): Candidate[] {
  const inheritance = tax.inheritance;
  if (!inheritance) return [];
  const out: Candidate[] = [];
  for (const ira of inheritance.inherited) {
    const m = inheritedIraMessage(inheritance, ira);
    if (m) out.push(card("decision", m, `inherited:${ira.accountId}`, P.inherited));
  }
  const gifts = giftsMessage(inheritance);
  if (gifts) {
    out.push(
      card(
        "heads_up",
        gifts,
        `gifts:${inheritance.year}:${inheritance.gifts[0].recipient}`,
        P.gifts,
      ),
    );
  }
  return out;
}

// Spec step 269: a Marketplace credit that would come back as a bill, an HSA over its limit,
// and a year of care worth itemizing.
function healthCards({ tax }: In): Candidate[] {
  const health = tax.health;
  if (!health) return [];
  const out: Candidate[] = [];
  const repay = repaymentMessage(health);
  if (repay) {
    out.push(
      card(
        health.advice ? "decision" : "heads_up",
        repay,
        `ptc:${health.year}:${health.marketplace.check?.overCliff ? "cliff" : "over"}`,
        P.ptc,
      ),
    );
  }
  const hsa = hsaMessage(health);
  if (hsa) out.push(card("heads_up", hsa, `hsa_excess:${health.year}`, P.hsa_excess));
  const medical = medicalMessage(health);
  if (medical) {
    out.push(card("heads_up", medical, `medical_deduction:${health.year}`, P.medical));
  }
  return out;
}

// Spec step 270: a disaster postponement for their county. At the levels that let Jane act
// the deadlines are already moved (autopilot); at "ask first" a tap moves them.
function disasterCards({ tax }: In): Candidate[] {
  const disaster = tax.disaster;
  if (!disaster) return [];
  return disaster.relief.map((r) =>
    card(
      r.applied ? "done" : "decision",
      reliefMessage(disaster, r),
      `disaster:${r.relief.id}${r.applied ? ":moved" : ""}`,
      P.disaster,
    ),
  );
}

// Spec step 271: Social Security's taxable part nothing withholds, and Medicare's surcharge
// line two years ahead (with the tuned order, as demo advice) from October, when the year's
// last withdrawals and conversions are planned.
function retirementCards({ tax, context }: In): Candidate[] {
  const retirement = tax.retirement;
  if (!retirement) return [];
  const out: Candidate[] = [];
  const ss = ssWithholdingMessage(retirement);
  if (ss) out.push(card("heads_up", ss, `ss_tax:${retirement.year}`, P.ss_tax));
  const watch =
    context.local.date.slice(5, 7) >= "10" && retirement.balances.preTaxCents > 0
      ? irmaaMessage(retirement)
      : null;
  if (watch) {
    out.push(
      card(watch.refs.advice ? "decision" : "heads_up", watch, `irmaa:${retirement.year}`, P.irmaa),
    );
  }
  return out;
}

// Spec step 272: a draft return read and waiting for the person's confirm, and each thing
// the check of a confirmed draft found, as a card with its dollars.
function draftCards({ tax }: In): Candidate[] {
  return (tax.drafts ?? []).flatMap((d) =>
    d.status === "waiting"
      ? [card("decision", draftReadingMessage(d), `draft:${d.id}`, P.draft)]
      : d.findings.map((f) =>
          card("heads_up", draftFindingMessage(d, f), `draft:${d.id}:${f.key}`, P.draft),
        ),
  );
}

// Spec step 218: the IP PIN in January (already on the deadlines at the levels that let
// Jane act); a sign of identity theft it noticed; and an open case's next step.
function identityCards({ tax, acts }: In): Candidate[] {
  const identity = tax.identity;
  if (!identity) return [];
  const out: Candidate[] = [];
  if (identity.season && !identity.havePin) {
    out.push(
      card(
        acts && identity.reminded ? "done" : "decision",
        ipPinMessage(identity, acts && identity.reminded),
        `ippin:${identity.year}`,
        P.ip_pin,
      ),
    );
  }
  for (const c of identity.candidates) {
    out.push(card("decision", signMessage(c), `identity-sign:${c.key}`, P.identity));
  }
  const step = caseMessage(identity);
  if (step) {
    out.push(
      card(
        "decision",
        step,
        `identity-step:${identity.case!.id}:${identity.case!.next}`,
        P.identity,
      ),
    );
  }
  return out;
}

// Spec step 217: tax notices. Urgent: a notice to confirm, then one to answer (again
// as the date nears), then the draft to hand over.
function noticeCards({ tax, snapshot, context }: In): Candidate[] {
  const out: Candidate[] = [];
  for (const { notice: n, check } of tax.notices ?? []) {
    if (n.status === "waiting") {
      out.push(card("decision", noticeReadingMessage(n), `notice:${n.id}`, P.notice));
    } else if (n.status === "confirmed" && !n.handledBy) {
      if (n.draft) {
        out.push(
          card(
            "decision",
            noticeDraftMessage(n, snapshot.concierge !== false),
            `notice-draft:${n.id}:${n.response}`,
            P.notice,
          ),
        );
      } else if (check) {
        out.push(
          card(
            "decision",
            noticeOpenMessage(n, check, context.local.date),
            `notice-open:${n.id}:${remindDays(n, context.local.date) ?? 0}`,
            P.notice,
          ),
        );
      }
    }
  }
  return out;
}

// Spec step 173: a rental that needs its property for depreciation; hobby or business
// (demo advice, with both taxes shown).
function sideIncomeCards({ tax }: In): Candidate[] {
  const side = tax.sideIncome;
  if (!side) return [];
  const out: Candidate[] = [];
  const setup = rentalSetupMessage(side);
  if (setup) out.push(card("heads_up", setup, `rental:${side.year}`, P.rental_setup));
  const kind = tax.advice ? hobbyMessage(side) : null;
  if (kind) out.push(card("decision", kind, `sidekind:${side.year}`, P.side_kind));
  return out;
}

// Spec step 172: a return Jane read, to confirm; and what its review found.
function priorReturnCards({ tax }: In): Candidate[] {
  return [
    ...(tax.priorReturns ?? []).map((r) =>
      card("decision", readingMessage(r), `prior:${r.id}`, P.prior_return),
    ),
    ...(tax.returnReviews ?? [])
      .filter((r) => r.worthAmending || r.amendment)
      .map((r) =>
        card(
          "decision",
          reviewMessage(r),
          `review-return:${r.year}:${r.amendment?.status ?? "open"}`,
          P.prior_review,
        ),
      ),
  ];
}

// Spec step 171: a year's records that can be thrown away soon (the reminder is on the
// deadlines already at the levels that let Jane act).
function recordsCards({ tax, acts }: In): Candidate[] {
  if (acts) return [];
  return (tax.records?.due ?? []).map((r) =>
    card("heads_up", retentionMessage(r), `records:${r.year}`, P.records),
  );
}

// Spec step 170: the state and local tax cap biting once property tax is paid, and a
// home sale against the exclusion, once each a year.
function homeCards({ tax }: In): Candidate[] {
  const homeTax = tax.home;
  if (!homeTax) return [];
  const out: Candidate[] = [];
  const cap = saltCapMessage(homeTax);
  if (cap) out.push(card("heads_up", cap, `salt:${homeTax.year}`, P.salt_cap));
  const sale = homeSaleMessage(homeTax);
  if (sale) {
    out.push(
      card("heads_up", sale, `homesale:${homeTax.year}:${homeTax.sale!.sale.cents}`, P.home_sale),
    );
  }
  return out;
}

// Spec step 166: with a document partner, Jane collects the forms itself: a form that
// doesn't match the accounts, the ones collected, and one still missing a week after its
// date. Without one (step 119), from late January it asks whether each form has arrived.
function documentCards({ tax, acts }: In): Candidate[] {
  const docs = tax.documents;
  if (!docs?.collecting) {
    const due = tax.formsDue;
    return (due?.forms ?? []).map((form) =>
      card(
        "heads_up",
        {
          body: `Your ${form.form} from ${form.from} for ${due!.year} is usually sent by ${dayLabel(form.by)}. Have you got it?`,
          refs: { taxForm: form.key, taxYear: due!.year },
          actions: [
            { id: "tax.form_got", label: "I have it", kind: "primary" },
            snoozeButton("Not yet"),
            openLink("See tax forms", "/taxes?focus=records:forms"),
          ],
        },
        `form:${due!.year}:${form.key}`,
        P.form_due,
      ),
    );
  }
  const out = docs.flagged.map((f) =>
    card(
      "decision",
      flaggedMessage(f, docs.year),
      `doc:${docs.year}:${f.key}:differs`,
      P.doc_flagged,
    ),
  );
  const collected = collectedMessage(docs, acts);
  if (collected) {
    const n = docs.forms.filter((f) => f.document && f.usable).length;
    out.push(
      card(
        collected.actions.some((a) => a.id === "tax.docs_tick") ? "decision" : "done",
        collected,
        `docs:${docs.year}:${n}`,
        P.doc_collected,
      ),
    );
  }
  for (const f of docs.missing) {
    out.push(
      card(
        "heads_up",
        missingMessage(f, docs.year),
        `docmissing:${docs.year}:${f.key}`,
        P.doc_missing,
      ),
    );
  }
  return out;
}

// In the order Jane has always gathered them; the brain sorts by priority.
const TOPICS: ((input: In) => Candidate[])[] = [
  profileCards,
  tagCards,
  estimateCards,
  residencyCards,
  withholdingCards,
  savingCards,
  selfEmployedCards,
  refundCards,
  investmentCards,
  januaryCards,
  filingCards,
  planCards,
  givingCards,
  familyCards,
  equityCards,
  yearsCards,
  propertyCards,
  accountantCards,
  calendarCards,
  businessCards,
  inheritanceCards,
  healthCards,
  disasterCards,
  retirementCards,
  draftCards,
  identityCards,
  noticeCards,
  sideIncomeCards,
  priorReturnCards,
  recordsCards,
  homeCards,
  documentCards,
];

export const taxesSource: MessageSource = {
  key: "taxes",
  gather(snapshot, context) {
    const tax = snapshot.tax;
    if (!tax) return [];
    const acts = ["safe", "all", "custom"].includes(snapshot.autopilot ?? "");
    return TOPICS.flatMap((topic) => topic({ tax, snapshot, context, acts }));
  },
};

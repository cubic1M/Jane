import { FILING_STATUSES, INCOME_KINDS, whatJaneDoes, type FilingStatus } from "@/config/tax";
import { stateName, type FieldStatus, type TaxProfileView } from "@/planning/tax-profile";
import { TAX_TAG_ORDER, TAX_TAGS, UNTAGGED, type TaxTagKind } from "@/config/tax";
import { formatCents } from "@/lib/money";
import { STANDARD_DEDUCTION } from "@/config/tax-rates";
import type { TaxFormsView, TaxTagsView } from "@/lib/tax-organizer";
import type { TaxEstimateView } from "@/lib/tax-estimate";
import type { WithholdingView } from "@/lib/tax-withholding";
import type { TaxSavingsView } from "@/lib/tax-savings";
import { savingMessage } from "./tax-saving-message";
import type { SelfEmployedView } from "@/lib/self-employed";
import { mileageDeduction } from "@/planning/self-employed";
import type { TaxIntent } from "./tax-intents";
import { quarterMessage, setAsideMessage } from "./tax-self-employed";
import type { RefundView } from "@/lib/tax-refund";
import { refundMessage } from "./tax-refund-message";
import type { ReturnView } from "@/lib/tax-filing";
import { filingAccepted, filingOffer, filingReady } from "./tax-filing-message";
import { onTrackLine, w4Suggestion, withholdingFacts } from "./tax-w4";
import {
  balancePhrase as balancePhraseOf,
  federalLine,
  roundDollars,
  stateLine,
} from "@/planning/tax-estimate-copy";
import type { TaxPack } from "@/planning/tax-pack";
import { listOf } from "@/planning/tax-profile";
import type { Reply } from "./replies";

import { FILING_BUTTONS, KIDS_BUTTONS, PROFILE_HREF, TAGS_HREF, nextQuestion } from "./tax-flow";
import type { MessageAction } from "./types";

// Jane's answers about taxes (spec steps 118–127), in fixed wording from the profile's own
// numbers. Each answer that would change something offers a button, checked again when
// tapped; typing alone changes nothing.

const link = (label: string, href = PROFILE_HREF): MessageAction => ({
  id: "open",
  label,
  kind: "link",
  href,
});

const WHERE: Readonly<Record<FieldStatus, string>> = {
  yours: "",
  found: " (found by me: check it)",
  missing: "",
};

// "Here's your tax profile: …", with the next question's buttons when one is waiting.
export function taxProfileReply(view: TaxProfileView, autopilot: string | null): Reply {
  const kids = view.dependants;
  const lines = [
    `- How you file: ${view.filingStatus.value ? FILING_STATUSES[view.filingStatus.value] : "not set yet"}`,
    `- Dependants: ${
      kids.status === "yours"
        ? `${kids.childrenUnder17} under 17, ${kids.otherDependants} other`
        : "not set yet"
    }`,
    `- State: ${view.state.value ? `${stateName(view.state.value)}${WHERE[view.state.status]}` : "not set yet"}`,
    `- Income: ${
      view.incomeKinds.value.length > 0
        ? `${view.incomeKinds.value.map((k) => INCOME_KINDS[k].label.toLowerCase()).join("; ")}${WHERE[view.incomeKinds.status]}`
        : "none seen yet"
    }`,
  ];
  const doing = whatJaneDoes(autopilot)[0];
  const question = nextQuestion(view);
  const set = [view.filingStatus, view.dependants, view.state, view.incomeKinds].filter(
    (f) => f.status === "yours",
  ).length;
  const lead =
    set === 4
      ? "Your tax profile is complete."
      : `Your tax profile has ${set} of 4 answers so far; the rest are found by me or not set yet.`;
  const body = `${lead}\n${lines.join("\n")}\n${doing}${question ? `\n\n${question.body}` : ""}`;
  return {
    body,
    actions: [
      ...(question?.actions.filter((a) => a.kind !== "link") ?? []),
      link("See my tax profile"),
    ],
    refs: question?.refs ?? {},
  };
}

export function setFilingReply(status: FilingStatus | null): Reply {
  if (status === null) {
    return {
      body: "Will you file jointly or separately? I'll put it on your tax profile.",
      actions: [
        { id: FILING_BUTTONS.married_joint, label: FILING_STATUSES.married_joint, kind: "primary" },
        {
          id: FILING_BUTTONS.married_separate,
          label: FILING_STATUSES.married_separate,
          kind: "secondary",
        },
        link("See my tax profile"),
      ],
      refs: { taxField: "filingStatus" },
    };
  }
  return {
    body: `Want me to put "${FILING_STATUSES[status]}" on your tax profile?`,
    actions: [
      { id: FILING_BUTTONS[status], label: "Yes, put it on", kind: "primary" },
      link("See my tax profile"),
    ],
    refs: { taxField: "filingStatus" },
  };
}

export function setKidsReply(count: number): Reply {
  if (count >= KIDS_BUTTONS.length) {
    return {
      body: `You can put ${count} children on your tax profile, with any other dependants.`,
      actions: [link("Open my tax profile")],
      refs: {},
    };
  }
  return {
    body: `Want me to put ${count === 0 ? "no children" : `${count} ${count === 1 ? "child" : "children"}`} under 17 on your tax profile?`,
    actions: [
      { id: KIDS_BUTTONS[count], label: "Yes, put it on", kind: "primary" },
      link("See my tax profile"),
    ],
    refs: { taxField: "dependants" },
  };
}

export function setStateReply(state: string): Reply {
  return {
    body: `Want me to put ${stateName(state)} on your tax profile as the state you file in?`,
    actions: [
      { id: "tax.state_set", label: "Yes, put it on", kind: "primary" },
      link("See my tax profile"),
    ],
    refs: { taxField: "state", taxState: state },
  };
}

// Spec step 119: the tags so far.
export function tagsReply(view: TaxTagsView): Reply {
  const lines = TAX_TAG_ORDER.filter((t) => view.totals[t].count > 0).map(
    (t) =>
      `- ${TAX_TAGS[t].label}: ${formatCents(view.totals[t].totalCents)} (${view.totals[t].count})`,
  );
  const body =
    lines.length === 0
      ? `I haven't tagged anything for your ${view.year} taxes yet. I tag donations, medical, childcare and education spending as it comes in, and you can tag work expenses yourself.`
      : `Here's what I've tagged for your ${view.year} taxes:\n${lines.join("\n")}${
          view.checks.length > 0
            ? `\nI'm not sure about ${view.checks.length} ${view.checks.length === 1 ? "merchant" : "merchants"}, so I've asked you about ${view.checks.length === 1 ? "it" : "them"}.`
            : ""
        }`;
  return { body, actions: [link("See tax tags", TAGS_HREF)], refs: {} };
}

export function tagTotalReply(view: TaxTagsView, tag: TaxTagKind): Reply {
  const rows = view.tagged.filter((t) => t.tag === tag);
  const total = view.totals[tag];
  if (rows.length === 0) {
    return {
      body: `Nothing's tagged ${TAX_TAGS[tag].label.toLowerCase()} for ${view.year} yet.`,
      actions: [link("See tax tags", TAGS_HREF)],
      refs: {},
    };
  }
  const byPayee = new Map<string, number>();
  for (const r of rows) byPayee.set(r.payee, (byPayee.get(r.payee) ?? 0) + r.amountCents);
  const top = [...byPayee.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([payee, cents]) => `${payee} ${formatCents(cents)}`);
  return {
    body: `You've ${tag === "donation" ? `given ${formatCents(total.totalCents)} to charity` : `spent ${formatCents(total.totalCents)} on ${TAX_TAGS[tag].plural}`} in ${view.year} so far, by my tax tags (${total.count}): ${listOf(top)}${byPayee.size > 3 ? " and more" : ""}. It's all in your tax-time pack.`,
    actions: [link("See tax tags", TAGS_HREF), link("Open the tax-time pack", "/tax-pack")],
    refs: {},
  };
}

// "tag Staples as work": the merchant's charges this year, and a button to tag them all.
export function tagReply(
  view: TaxTagsView,
  matches: { merchantKey: string; payee: string; count: number; totalCents: number } | null,
  target: string,
  tag: TaxTagKind | null,
): Reply {
  if (!matches) {
    return {
      body: `I couldn't find charges from "${target}" in ${view.year}. You can search for it on your tax tags.`,
      actions: [link("Find it", `${TAGS_HREF}?q=${encodeURIComponent(target)}`)],
      refs: {},
    };
  }
  const what = `your ${matches.count} ${matches.payee} ${matches.count === 1 ? "charge" : "charges"} this year (${formatCents(matches.totalCents)})`;
  return {
    body: tag
      ? `Want me to tag ${what} as ${TAX_TAGS[tag].plural}? New ones will be tagged the same way.`
      : `Want me to untag ${what}, so they're left out of your taxes?`,
    actions: [
      { id: "tax.tag_set", label: tag ? "Yes, tag them" : "Yes, untag them", kind: "primary" },
      link("See tax tags", TAGS_HREF),
    ],
    refs: { merchantKey: matches.merchantKey, taxTag: tag ?? UNTAGGED },
  };
}

const usualDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

export function formsReply(view: TaxFormsView): Reply {
  if (view.forms.length === 0) {
    return {
      body: `I don't expect any tax forms for ${view.year} from what's in your accounts. If you were paid somewhere I can't see, that payer sends its own.`,
      actions: [link("See your taxes", "/taxes#forms")],
      refs: {},
    };
  }
  const lines = view.forms.map(
    (f) =>
      `- ${f.form} from ${f.from}: ${
        f.received
          ? "you have it"
          : f.mayNotSend
            ? "may not send one (below the reporting threshold)"
            : `usually sent by ${usualDate(f.by)}`
      }`,
  );
  return {
    body: `I expect ${view.forms.length} tax ${view.forms.length === 1 ? "form" : "forms"} for ${view.year}, from your accounts.\n${lines.join("\n")}`,
    actions: [link("See tax forms", "/taxes#forms")],
    refs: {},
  };
}

export function packReply(pack: TaxPack): Reply {
  const all: [string, number][] = [
    ["donations", pack.charity.totalCents],
    ...(Object.keys(pack.preparer) as (keyof TaxPack["preparer"])[]).map((g): [string, number] => [
      TAX_TAGS[g].plural,
      pack.preparer[g].totalCents,
    ]),
  ];
  const groups = all.filter(([, cents]) => cents > 0);
  const waiting = pack.forms.filter((f) => !f.received && !f.mayNotSend).length;
  return {
    body: `Your ${pack.year} tax-time pack has ${
      groups.length > 0
        ? listOf(groups.map(([label, cents]) => `${label} ${formatCents(cents)}`))
        : "nothing tagged yet"
    }${pack.income.totalCents > 0 ? `, and ${formatCents(pack.income.totalCents)} of contracting or gig income` : ""}. ${
      pack.forms.length > 0
        ? `I expect ${pack.forms.length} tax ${pack.forms.length === 1 ? "form" : "forms"}${waiting > 0 ? `, ${waiting} still to come` : ""}.`
        : ""
    } You can download it as a spreadsheet.`.trim(),
    actions: [
      link("Open the tax-time pack", `/tax-pack?year=${pack.year}`),
      link("Download the spreadsheet", `/tax-pack/download?year=${pack.year}`),
    ],
    refs: {},
  };
}

// Spec step 120: the estimate, as Jane brings it up and as she answers "how much will I
// owe?". Always called an estimate.
export function estimateMessage(view: TaxEstimateView): Reply {
  const e = view.estimate;
  const state = stateLine(e.state, view.withholdingKnown);
  const sofar =
    view.elapsed < 1
      ? ` It's from your income so far (${roundDollars(view.incomeSoFarCents)}), projected to the end of the year.`
      : "";
  const assumed = view.assumptions.find((a) => a.startsWith("You haven't told me how you file"));
  return {
    body: `My estimate for your ${view.year} taxes: ${federalLine(e, view.withholdingKnown).replace(/^Federal: /, "federal, ")}${state ? ` ${state}` : ""}${sofar}${assumed ? ` ${assumed}` : ""} I update it after every sync.`,
    actions: [
      link("See the estimate", "/taxes#estimate"),
      ...(view.withholdingKnown ? [] : [link("Add pay stub figures", `${PROFILE_HREF}#pay-stub`)]),
    ],
    refs: {},
  };
}

export function bracketReply(view: TaxEstimateView): Reply {
  const rate = Math.round(view.estimate.marginalRate * 100);
  return {
    body: `Your top federal rate is about ${rate}%: each extra $100 of income adds about $${rate} of federal tax, before any state tax. That's from my ${view.year} estimate.`,
    actions: [link("See the estimate", "/taxes#estimate")],
    refs: {},
  };
}

// Spec step 121: "am I withholding enough?"
export function withholdingReply(view: WithholdingView): Reply {
  const { check, estimate } = view;
  switch (check.status) {
    case "unknown": {
      // Taxes QA: self-employment income has no withholding; the answer is the quarterly plan.
      const owed = -estimate.estimate.refundCents;
      if (check.why === "no_pay" && estimate.input.income.selfEmploymentCents > 0) {
        return {
          body: `Nobody withholds tax from self-employment income, so you pay it yourself in quarterly estimated payments.${owed > 0 ? ` By my estimate about ${formatCents(owed)} is still to pay for ${estimate.year}.` : ` By my estimate you've paid enough for ${estimate.year}.`}`,
          actions: [link("See the quarterly plan", "/taxes/self-employed")],
          refs: {},
        };
      }
      return {
        body:
          check.why === "no_pay"
            ? "I can't see regular paychecks in your accounts, so I can't check your withholding."
            : "I can see your paychecks but not what's withheld from them. Add the figures from your latest pay stub and I'll check.",
        actions: [link("Add pay stub figures", `${PROFILE_HREF}#pay-stub`)],
        refs: {},
      };
    }
    case "on_track":
      return {
        body: onTrackLine(estimate, check.refundCents),
        actions: [link("See the estimate", "/taxes#withholding")],
        refs: {},
      };
    default:
      return view.advice ? w4Suggestion(estimate, check) : withholdingFacts(estimate, check);
  }
}

// Spec step 122: "how can I pay less tax?" Demo advice only.
export function savingsReply(view: TaxSavingsView): Reply {
  if (!view.advice) {
    return {
      body: "Suggestions on paying less tax will come once Jane works with a tax professional. For now I can show your estimate, your tax tags and the forms to expect.",
      actions: [link("See your taxes", "/taxes")],
      refs: {},
    };
  }
  const [first, ...rest] = view.savings;
  if (!first) {
    return {
      body: `I haven't found more ways for you to pay less for ${view.year} from what's in your accounts.`,
      actions: [link("See your taxes", "/taxes#savings")],
      refs: { advice: true },
    };
  }
  const top = savingMessage(first, view.year);
  const more =
    rest.length > 0
      ? `\n\nAlso: ${rest
          .slice(0, 3)
          .map((s) => `${s.title.replace(/\.$/, "")} (about ${roundDollars(s.estimateCents)})`)
          .join("; ")}.`
      : "";
  return {
    body: `${top.body}${more}`,
    actions: [...top.actions, link("All of them", "/taxes#savings")],
    refs: top.refs,
  };
}

// Spec step 123: freelancers' questions.
export function selfEmployedReply(intent: TaxIntent, view: SelfEmployedView, now: Date): Reply {
  const page = link("Freelance taxes", "/taxes/self-employed");
  if (intent.ask === "miles") {
    if (intent.miles !== null && intent.miles > 0) {
      return {
        body: `Want me to add ${intent.miles.toLocaleString("en-US")} business miles to this year's? At the 2026 rate that's about ${roundDollars(mileageDeduction(intent.miles))} off your freelance income.`,
        actions: [{ id: "tax.miles_add", label: "Add them", kind: "primary" }, page],
        refs: { taxMiles: intent.miles },
      };
    }
    return {
      body: `You've logged ${view.mileage.miles.toLocaleString("en-US")} business miles this year, worth about ${roundDollars(view.mileage.deductionCents)} off your freelance income. Tell me "I drove 40 business miles" to add more.`,
      actions: [page],
      refs: {},
    };
  }
  if (intent.ask === "home_office") {
    return {
      body: view.homeOffice.sqft
        ? `Your home office is ${view.homeOffice.sqft} square feet: about ${roundDollars(view.homeOffice.deductionCents)} off your freelance income (the simplified method, $5 a square foot up to 300).`
        : "If you use part of your home only for your freelance work, the simplified method takes $5 a square foot off your freelance income, up to 300 square feet. Tell me its size on your freelance taxes page.",
      actions: [page],
      refs: {},
    };
  }
  if (!view.active) {
    return {
      body: "I don't see freelance or gig income in your accounts this year, so there's nothing to pay ahead.",
      actions: [page],
      refs: {},
    };
  }
  if (!view.advice) {
    return {
      body: "Estimated tax is usually due April 15, June 15, September 15 and January 15. The IRS's estimated tax page explains who pays and how much.",
      actions: [
        link(
          "Estimated taxes on irs.gov",
          "https://www.irs.gov/businesses/small-businesses-self-employed/estimated-taxes",
        ),
        page,
      ],
      refs: {},
    };
  }
  if (intent.ask === "set_aside") {
    const last = view.recent[0];
    if (last) return setAsideMessage(view, last);
    return {
      body: `Set aside about ${Math.round(view.setAsideRate * 100)}% of each freelance payment for its taxes, by my estimate.`,
      actions: [page],
      refs: { advice: true },
    };
  }
  const today = now.toISOString().slice(0, 10);
  const next = view.federal.payments.find((p) => p.date >= today);
  if (!next) {
    return {
      body: view.federal.needed
        ? `No estimated payment dates are left for ${view.year}; I estimate about ${roundDollars(view.federal.owedCents)} still to pay with your return.`
        : `By my estimate you won't owe enough for ${view.year} to need estimated payments (under $1,000).`,
      actions: [page],
      refs: { advice: true },
    };
  }
  const state = view.state?.payments.find((p) => p.date === next.date)?.cents ?? 0;
  return quarterMessage(view, { ...next, stateCents: state });
}

// Spec step 125: "where's my refund?"
export function refundReply(refunds: RefundView[], estimate: TaxEstimateView): Reply {
  const latest = refunds.find((r) => !r.handled) ?? refunds[0];
  if (latest) return refundMessage(latest);
  const e = estimate.estimate;
  return {
    body:
      estimate.withholdingKnown && e.refundCents > 0
        ? `I haven't seen a tax refund in your accounts yet. For ${estimate.year} I estimate ${balancePhraseOf(e.refundCents)}; I'll tell you when it lands.`
        : "I haven't seen a tax refund in your accounts. I'll tell you when one lands.",
    actions: [link("See the estimate", "/taxes#estimate")],
    refs: {},
  };
}

// Spec step 126: "file my taxes", "when are taxes due".
export function fileReply(f: {
  year: number;
  inSeason: boolean;
  available: boolean;
  ret: ReturnView | null;
  profile: TaxProfileView;
}): Reply {
  const deadline = `Returns for ${f.year} are due April 15, ${f.year + 1} (October 15 with an extension).`;
  if (!f.available) {
    return {
      body: `${deadline} Filing through Jane isn't available for your accounts yet; your tax-time pack is ready for whoever does your taxes.`,
      actions: [link("Open the tax-time pack", `/tax-pack?year=${f.year}`)],
      refs: {},
    };
  }
  if (f.ret?.status === "ready_for_review") return filingReady(f.ret);
  if (f.ret?.status === "accepted") return filingAccepted(f.ret);
  if (f.ret?.status === "submitted") {
    return {
      body: `Your ${f.year} return is signed and sent; I'm waiting for it to be accepted.`,
      actions: [link("See your return", "/taxes/file")],
      refs: {},
    };
  }
  if (!f.inSeason) {
    return {
      body: `${deadline} Filing opens in late January ${f.year + 1}; I'll have everything ready.`,
      actions: [link("See your taxes", "/taxes")],
      refs: {},
    };
  }
  const offer = filingOffer(f.year, f.profile, 0);
  return { ...offer, actions: offer.actions.filter((a) => a.id !== "snooze") };
}

// Spec step 127: "what's the standard deduction?", from the config and the estimate.
export function standardDeductionReply(view: TaxEstimateView): Reply {
  const d = view.estimate.deduction;
  const status = FILING_STATUSES[view.estimate.filingStatus].toLowerCase();
  const yours =
    d.kind === "itemized"
      ? ` Filing as ${status}, yours is ${formatCents(d.standardCents)}, but I estimate itemizing gives you more (about ${roundDollars(d.itemizedCents)}).`
      : ` Filing as ${status}, yours is ${formatCents(d.standardCents)}, and it's more than itemizing would give you.`;
  return {
    body: `The ${view.year} standard deduction is ${formatCents(STANDARD_DEDUCTION.single)} for single filers, ${formatCents(STANDARD_DEDUCTION.married_joint)} married filing jointly and ${formatCents(STANDARD_DEDUCTION.head_of_household)} head of household.${yours}`,
    actions: [link("See the estimate", "/taxes#estimate")],
    refs: {},
  };
}

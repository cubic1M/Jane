import { FILING_STATUSES, INCOME_KINDS, whatJaneDoes, type FilingStatus } from "@/config/tax";
import { stateName, type FieldStatus, type TaxProfileView } from "@/planning/tax-profile";
import { TAX_TAG_ORDER, TAX_TAGS, UNTAGGED, type TaxTagKind } from "@/config/tax";
import { formatCents } from "@/lib/money";
import type { TaxFormsView, TaxTagsView } from "@/lib/tax-organizer";
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
  const body = `Here's your tax profile:\n${lines.join("\n")}\n${doing}${question ? `\n\n${question.body}` : ""}`;
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
    body: `So far in ${view.year} I've tagged ${formatCents(total.totalCents)} of ${TAX_TAGS[tag].plural} (${total.count}): ${listOf(top)}${byPayee.size > 3 ? " and more" : ""}. It's all in your tax-time pack.`,
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
    body: `The tax forms I expect for ${view.year}, from your accounts:\n${lines.join("\n")}`,
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

import { FILING_STATUSES, INCOME_KINDS, TAX_AUTOPILOT, type FilingStatus } from "@/config/tax";
import { stateName, type FieldStatus, type TaxProfileView } from "@/planning/tax-profile";
import type { Reply } from "./replies";
import { FILING_BUTTONS, KIDS_BUTTONS, PROFILE_HREF, nextQuestion } from "./tax-flow";
import type { TaxIntent } from "./tax-intents";
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
  const level = (autopilot ?? "none") as keyof typeof TAX_AUTOPILOT;
  const doing = (TAX_AUTOPILOT[level] ?? TAX_AUTOPILOT.none)[0];
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

// Pure: the reply for a tax intent, from the loaded profile.
export function taxReply(intent: TaxIntent, view: TaxProfileView, autopilot: string | null): Reply {
  switch (intent.ask) {
    case "profile":
      return taxProfileReply(view, autopilot);
    case "set_filing":
      return setFilingReply(intent.status);
    case "set_kids":
      return setKidsReply(intent.count);
    case "set_state":
      return setStateReply(intent.state);
  }
}

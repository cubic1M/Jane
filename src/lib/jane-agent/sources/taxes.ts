import { TAX_MESSAGE_PRIORITY } from "@/config/tax";
import { incomeLine } from "@/planning/tax-profile";
import { PROFILE_HREF, PROFILE_INTRO, nextQuestion } from "../tax-flow";
import { snoozeButton, type MessageSource } from "./source";

// Taxes (spec step 118): the tax profile, asked one question at a time in one message
// (../tax-flow.ts) until it's done; once, and back after "Not now". Then, when Jane sees a
// kind of income that isn't on the profile, she asks before adding it. Jane never adds
// anything to the profile by herself.

export const taxesSource: MessageSource = {
  key: "taxes",
  gather(snapshot) {
    const profile = snapshot.tax?.profile;
    if (!profile) return [];
    // Only once Jane has something to work from (income in their accounts) or the person
    // has started on it themselves.
    const started =
      profile.incomeKinds.found.length > 0 ||
      (["incomeKinds", "filingStatus", "dependants", "state"] as const).some(
        (f) => profile[f].status === "yours",
      );
    const question = started ? nextQuestion(profile) : null;
    const ask = question
      ? [
          {
            kind: "decision" as const,
            body: `${PROFILE_INTRO} ${question.body}`,
            refs: question.refs,
            actions: [...question.actions, snoozeButton()],
            dedupeKey: "profile",
            priority: TAX_MESSAGE_PRIORITY.profile,
          },
        ]
      : [];
    const added = profile.newIncome.map((found) => ({
      kind: "decision" as const,
      body: `I've started seeing ${incomeLine(found)} in your accounts. It isn't on your tax profile yet. Add it?`,
      refs: { incomeKind: found.kind },
      actions: [
        { id: "tax.income_add" as const, label: "Add it", kind: "primary" as const },
        { id: "tax.income_no" as const, label: "Leave it off", kind: "secondary" as const },
        {
          id: "open" as const,
          label: "See my tax profile",
          kind: "link" as const,
          href: PROFILE_HREF,
        },
      ],
      dedupeKey: `income:${found.kind}`,
      priority: TAX_MESSAGE_PRIORITY.new_income,
    }));
    return [...ask, ...added];
  },
};

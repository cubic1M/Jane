import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { kindWords } from "@/lib/insurance/gaps";
import type { Candidate } from "../types";
import { snoozeButton, type MessageSource } from "./source";

// Insurance (spec Phase X). Step 102: cover that looks missing, as a heads-up, once per
// gap: "I have this" opens the add form for that kind, "I don't need it" never brings it up
// again, "Not now" until tomorrow. Jane never buys cover.

export const insuranceSource: MessageSource = {
  key: "insurance",
  gather: (snapshot) =>
    (snapshot.insurance?.gaps ?? []).map((gap): Candidate => ({
      kind: "heads_up",
      body: `${gap.title}. ${gap.why}`,
      refs: { insuranceGap: gap.key, ...(gap.policyId ? { policyId: gap.policyId } : {}) },
      actions: [
        gap.policyId
          ? {
              id: "open",
              label: "Update the policy",
              kind: "link",
              href: `/insurance?edit=${gap.policyId}#policy-${gap.policyId}`,
            }
          : {
              id: "open",
              label: `I have ${kindWords(gap.kind)}`,
              kind: "link",
              href: `/insurance?add=${gap.kind}#add`,
            },
        { id: "insurance.gap_no", label: "I don't need it", kind: "secondary" },
        snoozeButton(),
      ],
      dedupeKey: `gap:${gap.key}`,
      priority: MESSAGE_PRIORITY.insurance_gap,
    })),
};

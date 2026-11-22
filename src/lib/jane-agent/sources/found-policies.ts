import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { POLICY_KINDS } from "@/config/insurance";
import { premiumWords } from "@/lib/insurance/premium-words";
import { type Candidate, openLink } from "../types";
import { type MessageSource } from "./source";
import { dayLabel } from "@/lib/day-label";

// Insurance found from payments (spec step 99): "I found your car insurance from your
// payments", once per policy, with Confirm (it becomes cover on the profile) and Not
// insurance. Until then it doesn't count, and its renewal date is an estimate.

const cover = (kind: keyof typeof POLICY_KINDS) =>
  kind === "other" ? "insurance" : `${POLICY_KINDS[kind].toLowerCase()} insurance`;

export const foundPoliciesSource: MessageSource = {
  key: "found",
  gather: (snapshot) =>
    (snapshot.insurance?.policies ?? [])
      .filter((p) => p.status === "found" && p.source === "payments")
      .map((p): Candidate => {
        const premium = premiumWords(p);
        const price = premium ? `, ${premium}` : "";
        const renews = p.nextRenewal
          ? ` It looks like it renews around ${dayLabel(p.nextRenewal)} (an estimate from when the payments started).`
          : "";
        return {
          kind: "decision",
          body: `I found your ${cover(p.kind)} from your payments: ${p.carrier}${price}.${renews} Is that right? It only counts on your profile once you confirm it.`,
          refs: { policyId: p.id },
          actions: [
            { id: "policy.confirm", label: "Confirm", kind: "primary" },
            { id: "policy.not_insurance", label: "Not insurance", kind: "secondary" },
            // Its own item on Insurance, which says the premium as this does, with its year.
            openLink("See insurance", `/insurance?focus=policies:${p.id}`),
          ],
          dedupeKey: p.id,
          priority: MESSAGE_PRIORITY.found_policy,
        };
      }),
};

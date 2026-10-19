import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { PREMIUM_FREQUENCIES } from "@/config/documents";
import { POLICY_KINDS } from "@/config/insurance";
import { formatCents } from "@/lib/money";
import type { Candidate } from "../types";
import { shortDate, type MessageSource } from "./source";

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
        const price =
          p.premiumCents !== null && p.premiumFrequency
            ? `, ${formatCents(p.premiumCents)} ${PREMIUM_FREQUENCIES[p.premiumFrequency].label}`
            : "";
        const renews = p.nextRenewal
          ? ` It looks like it renews around ${shortDate(p.nextRenewal)} (an estimate from when the payments started).`
          : "";
        return {
          kind: "decision",
          body: `I found your ${cover(p.kind)} from your payments: ${p.carrier}${price}.${renews} Is that right? It only counts on your profile once you confirm it.`,
          refs: { policyId: p.id },
          actions: [
            { id: "policy.confirm", label: "Confirm", kind: "primary" },
            { id: "policy.not_insurance", label: "Not insurance", kind: "secondary" },
            { id: "open", label: "See insurance", kind: "link", href: "/insurance" },
          ],
          dedupeKey: p.id,
          priority: MESSAGE_PRIORITY.found_policy,
        };
      }),
};

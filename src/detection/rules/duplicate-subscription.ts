import {
  DUPLICATE_MAX_CONFIDENCE,
  DUPLICATE_MIN_SERVICES,
  SERVICE_GROUPS,
} from "@/config/detection";
import { inList, lowest, merchantMatches } from "../helpers";
import type { Stream } from "../streams";
import type { Candidate } from "../types";
import { streamEvidence, type Rule } from "./rule";
import { isSubscription } from "./subscription-review";

type Group = (typeof SERVICE_GROUPS)[number];

function groupOf(stream: Stream): Group | undefined {
  return SERVICE_GROUPS.find(
    (group) =>
      inList(stream.pfcDetailed, group.categories) ||
      merchantMatches(stream.merchantKey, group.merchants),
  );
}

// Two or more active subscriptions to different services in one group. Savings are the
// annual cost of the cheaper one, the least the person saves by keeping just one.
export const duplicateSubscription: Rule = (_input, streams) => {
  const members = new Map<string, Stream[]>();
  for (const stream of streams.filter(isSubscription)) {
    const group = groupOf(stream);
    if (group) members.set(group.id, [...(members.get(group.id) ?? []), stream]);
  }

  return SERVICE_GROUPS.flatMap((group): Candidate[] => {
    const services = members.get(group.id) ?? [];
    if (new Set(services.map((s) => s.merchantKey)).size < DUPLICATE_MIN_SERVICES) return [];
    const cheapest = Math.min(...services.map((s) => s.annualCostCents ?? 0));
    return [
      {
        type: "duplicate_subscription",
        key: `group:${group.id}`,
        title: `You pay for ${services.length} ${group.label} services`,
        annualSavingsCents: cheapest,
        amountCents: cheapest,
        confidence: lowest(DUPLICATE_MAX_CONFIDENCE, ...services.map((s) => s.confidence)),
        evidence: {
          group: group.label,
          services: services.map(streamEvidence),
          // The streams it covers, so a single review of each isn't raised beside it (step 263).
          streamKeys: services.map((s) => s.key),
        },
      },
    ];
  });
};

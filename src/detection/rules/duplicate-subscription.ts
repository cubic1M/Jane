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

// Each service counted once, and one paid more than once named (debugger 11-02: Netflix on two
// cards, Hulu and Disney+ read "You pay for 4 video streaming services").
function titleOf(services: readonly Stream[], label: string): string {
  const streams = new Map<string, Stream[]>();
  for (const s of services) streams.set(s.merchantKey, [...(streams.get(s.merchantKey) ?? []), s]);
  const twice = [...streams.values()].filter((s) => s.length > 1).map((s) => s[0].merchant);
  const paid = twice.length > 0 ? `, and for ${twice.join(" and ")} twice` : "";
  return `You pay for ${streams.size} ${label} services${paid}`;
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
        title: titleOf(services, group.label),
        annualSavingsCents: cheapest,
        amountCents: cheapest,
        confidence: lowest(DUPLICATE_MAX_CONFIDENCE, ...services.map((s) => s.confidence)),
        evidence: { group: group.label, services: services.map(streamEvidence) },
      },
    ];
  });
};

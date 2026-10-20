import { gapAdvice } from "@/lib/insurance/gaps";
import type { Reply } from "../replies";
import type { InsuranceSnapshot } from "./snapshot";

// "Do I need business insurance for my side gig?" (spec step 201): the business gaps their
// freelance and gig signals open, and what a personal policy does not cover. The facts are for
// everyone; what to add is demo advice, only in demo advice mode and labelled. Pure.

const BUSINESS_KEYS = [
  "business_liability",
  "professional_liability",
  "car_business_use",
  "business_equipment",
] as const;

const SEE = { id: "open", label: "See your insurance", kind: "link", href: "/insurance" } as const;

export function businessReply(profile: InsuranceSnapshot | undefined): Reply {
  const gaps = (profile?.gaps ?? []).filter((g) =>
    (BUSINESS_KEYS as readonly string[]).includes(g.key),
  );
  if (gaps.length === 0) {
    return {
      body: "I don't see freelance or gig income in your accounts, so I'm not showing business gaps. Your home, renters and car policies cover your personal life, not work: a client who's hurt, work equipment or driving for pay. If you earn on the side, mark yourself self-employed on your tax profile and I'll look again.",
      actions: [SEE, { id: "open", label: "Your tax profile", kind: "link", href: "/taxes" }],
      refs: {},
    };
  }
  const advice = profile?.advice === true;
  return {
    body: [
      "Your side work leaves some things uncovered by your personal policies.",
      ...gaps.map((g) => `- ${g.title}. ${g.why}${advice ? ` ${gapAdvice(g).text}` : ""}`),
    ].join("\n"),
    actions: [SEE],
    refs: { insuranceGap: gaps[0].key, ...(advice ? { advice: true as const } : {}) },
  };
}

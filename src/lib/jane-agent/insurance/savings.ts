import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { partnerFor } from "@/lib/insurance/partner";
import { listPolicies } from "@/lib/insurance/policies";
import { listSavings, refreshSavings } from "@/lib/insurance/savings";
import type { Reply } from "../replies";
import {
  deductibleActions,
  deductibleBody,
  lowering,
  sameCover,
  sameCoverActions,
  sameCoverBody,
} from "./saving-words";

// "How can I pay less for my insurance?" (spec step 196): the cheaper ways to pay for the
// same cover Jane found, each with its yearly figure and what changes, and a tap to make
// them. A higher deductible, which lowers the cover, is said on its own.

const INSURANCE = {
  id: "open",
  label: "Your insurance",
  kind: "link",
  href: "/insurance?focus=savings",
} as const;

export async function savingsAnswer(
  userId: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<Reply> {
  if (!(await partnerFor(userId, { client })) || !(await adviceMode(userId, { client }))) {
    return {
      body: "I can't change how your policies are paid for yet, so I can't price those savings for you. Your insurer can tell you about paying in full, autopay and paperless discounts, and putting your car and home with one carrier.",
      actions: [INSURANCE],
      refs: {},
    };
  }
  await refreshSavings(userId, { client, now });
  const [savings, policies] = await Promise.all([
    listSavings(userId, { client, status: "offered" }),
    listPolicies(userId, { client }),
  ]);
  const same = sameCover(savings);
  const lower = lowering(savings);
  if (same.length > 0) {
    const extra = lower[0]
      ? `\nOne more lowers your cover, so I'd ask first: ${
          deductibleBody(
            lower[0],
            policies.find((p) => p.id === lower[0].policyId),
          ).split("\n")[0]
        }`
      : "";
    return {
      body: sameCoverBody(same, policies) + extra,
      actions: sameCoverActions(same),
      refs: { savingGroup: "same", advice: true as const },
    };
  }
  if (lower[0]) {
    return {
      body: deductibleBody(
        lower[0],
        policies.find((p) => p.id === lower[0].policyId),
      ),
      actions: deductibleActions(),
      refs: { savingId: lower[0].id, advice: true as const },
    };
  }
  return {
    body: "I don't see a cheaper way to pay for the cover you have right now: the discounts that apply are already on, or your cash wouldn't cover them. I'll look again when something changes.",
    actions: [INSURANCE],
    refs: {},
  };
}

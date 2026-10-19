import type { PrismaClient } from "@/generated/prisma/client";
import { canFile } from "@/lib/insurance/claim-filing";
import { listClaims } from "@/lib/insurance/claims";
import { listNegotiations, negotiationsDue } from "@/lib/insurance/negotiate";
import { listPolicies } from "@/lib/insurance/policies";
import type { Reply } from "../replies";
import {
  ASK_CALL_ACTIONS,
  askCallBody,
  callResultBody,
  draftActions,
  draftBody,
} from "./done-by-jane-words";

// "Can you get my renewal lowered?" and "file my claim for me" (spec step 155), answered
// from what Jane has: a renewal she can call about (with the person's OK, or done within
// their autopilot limits), and a claim she can file once they've checked the draft.

const INSURANCE = {
  id: "open",
  label: "Your insurance",
  kind: "link",
  href: "/insurance",
} as const;
const CLAIMS = { id: "open", label: "Claims", kind: "link", href: "/insurance/claims" } as const;

export async function renewalCallAnswer(
  userId: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<Reply> {
  await negotiationsDue(userId, { client, now });
  const [negotiations, policies] = await Promise.all([
    listNegotiations(userId, { client }),
    listPolicies(userId, { client }),
  ]);
  const policyOf = (id: string) => policies.find((p) => p.id === id);
  const asked = negotiations.find((n) => n.status === "asked");
  if (asked) {
    return {
      body: askCallBody(asked, policyOf(asked.policyId)),
      actions: ASK_CALL_ACTIONS,
      refs: { negotiationId: asked.id },
    };
  }
  const done = negotiations.filter((n) => n.status === "lowered" || n.status === "kept").at(-1);
  if (done) {
    return { body: callResultBody(done, policyOf(done.policyId)), actions: [INSURANCE], refs: {} };
  }
  return {
    body: "None of your policies is going up at renewal right now. When one does, I'll ask the insurer for a better rate (on autopilot, or with your OK) and shop it at the same time.",
    actions: [INSURANCE],
    refs: {},
  };
}

export async function fileClaimAnswer(
  userId: string,
  { client }: { client: PrismaClient; now: Date },
): Promise<Reply> {
  const open = (await listClaims(userId, { client })).filter((c) => c.status === "open");
  const draft = open.find((c) => c.filing === "draft");
  if (draft)
    return { body: draftBody(draft), actions: draftActions(draft), refs: { claimId: draft.id } };
  for (const claim of open) {
    if (await canFile(userId, claim, { client })) {
      return {
        body: `I can file your claim with ${claim.carrier ?? "your insurer"}. Tell me how much it is and what happened on the claims page, and I'll write it up for you to check before it goes.`,
        actions: [{ ...CLAIMS, href: `/insurance/claims#claim-${claim.id}` }],
        refs: {},
      };
    }
  }
  return {
    body:
      open.length > 0
        ? "I can't file this one for you: your insurer takes claims by phone or online, and the steps are on your claim tracker."
        : "Tell me what happened first, like \"I cracked my phone screen\", and I'll set up the claim's steps. If I can file it with your insurer, I'll offer to.",
    actions: [CLAIMS],
    refs: {},
  };
}

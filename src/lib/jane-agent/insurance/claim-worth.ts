import type { PolicyKind } from "@/config/insurance";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceLines, payoutLine } from "@/lib/insurance/claim-worth";
import { claimWorthFor } from "@/lib/insurance/claim-worth-for";
import type { Reply } from "../replies";

// "Is it worth claiming $1,200?" (spec step 199): what the insurer would pay after the
// deductible (a fact, for everyone), and, in demo advice mode, the three-year cost of the
// premium rise and the claims-free discount against it, with a plain verdict.

const CLAIMS = { id: "open", label: "Claims", kind: "link", href: "/insurance/claims" } as const;

export async function claimWorthAnswer(
  userId: string,
  input: { amountCents?: number; kind: PolicyKind | null; event?: string },
  { client }: { client: PrismaClient },
): Promise<Reply> {
  if (!input.amountCents) {
    return {
      body: 'Tell me roughly what the damage or loss costs, like "is it worth claiming a $1,200 repair", and I\'ll work out what your insurer would pay after your deductible.',
      actions: [CLAIMS],
      refs: {},
    };
  }
  const result = await claimWorthFor(
    userId,
    { amountCents: input.amountCents, kind: input.kind, event: input.event },
    { client },
  );
  if (!result.found) {
    return {
      body: "I don't see a policy on your insurance that this would be a claim on. Add it on your insurance page and I'll work out what a claim would pay.",
      actions: [{ id: "open", label: "Your insurance", kind: "link", href: "/insurance" }],
      refs: {},
    };
  }
  const { worth, advice } = result;
  return {
    body: [payoutLine(worth), ...(advice ? adviceLines(worth) : [])].join("\n"),
    actions: [CLAIMS],
    refs: advice ? { advice: true as const } : {},
  };
}

import type { PrismaClient } from "@/generated/prisma/client";
import { listRisks, refreshRisks } from "@/lib/insurance/risks";
import type { Reply } from "../replies";
import { riskActions, riskQuestion } from "./risk-words";

// "What am I missing?" (spec step 197): the question Jane has about how they live, with
// Yes and No right there, or what she's already noticed and been told.

const INSURANCE = {
  id: "open",
  label: "Your insurance",
  kind: "link",
  href: "/insurance#risks",
} as const;

export async function risksAnswer(
  userId: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<Reply> {
  await refreshRisks(userId, { client, now });
  const risks = await listRisks(userId, { client });
  const asked = risks.find((r) => r.status === "asked");
  if (asked) {
    return { body: riskQuestion(asked), actions: riskActions(), refs: { riskId: asked.id } };
  }
  const yes = risks.filter((r) => r.status === "yes");
  if (yes.length > 0) {
    return {
      body: `Nothing new in how you live. You told me about ${yes.length === 1 ? "one thing" : `${yes.length} things`} I'm watching your cover for, and they're on your insurance page.`,
      actions: [INSURANCE],
      refs: {},
    };
  }
  return {
    body: "I don't see anything in how you live that your cover might miss. I look at your payments for things like rideshare income, a home business, a new pet, a valuable purchase, a boat or renting your home out, and I'll ask if one shows up.",
    actions: [INSURANCE],
    refs: {},
  };
}

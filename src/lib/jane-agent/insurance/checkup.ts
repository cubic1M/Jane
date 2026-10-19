import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { runCheckup, type Checkup } from "@/lib/insurance/checkups";
import type { Reply } from "../replies";

// The coverage checkup in Jane's chat (spec step 106): the same words for the message Jane
// posts by herself and for "check my insurance". Demo advice: always labelled.

// Recommendations said in the chat; the rest are on the checkup page.
export const CHECKUP_SHOWN = 3;

const WHY = { life_event: "after your life event", asked: "as you asked", yearly: "for the year" };

export function checkupBody(checkup: Checkup): string {
  const recs = checkup.recommendations;
  const why = WHY[checkup.reason] ?? WHY.yearly;
  if (recs.length === 0) {
    return `I checked your insurance ${why}: nothing to change. Your deductibles fit your savings and your cover fits what you have.`;
  }
  return [
    `I checked your insurance ${why}. ${recs.length === 1 ? "One thing is" : `${recs.length} things are`} worth a look:`,
    ...recs.slice(0, CHECKUP_SHOWN).map((r) => `- ${r.title} ${r.cost}. ${r.risk}`),
    ...(recs.length > CHECKUP_SHOWN
      ? [`And ${recs.length - CHECKUP_SHOWN} more on the checkup page.`]
      : []),
    "Nothing changes unless you say so.",
  ].join("\n");
}

const SEE = {
  id: "open",
  label: "See the checkup",
  kind: "link",
  href: "/insurance/checkup",
} as const;

// "Check my insurance": runs the checkup now, in demo advice mode only.
export async function checkupAnswer(
  userId: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<Reply> {
  if (!(await adviceMode(userId, { client }))) {
    return {
      body: "Checking whether you have the right amount of cover means recommending changes, which I only do with demo data for now. I can still tell you what each policy covers and what looks missing.",
      actions: [{ id: "open", label: "See your insurance", kind: "link", href: "/insurance" }],
      refs: {},
    };
  }
  const checkup = await runCheckup(userId, "asked", { client, now });
  if (!checkup) {
    return {
      body: "I don't have any of your policies yet, so there's nothing to check. Add them and I'll check your cover.",
      actions: [{ id: "open", label: "Add a policy", kind: "link", href: "/insurance#add" }],
      refs: {},
    };
  }
  return {
    body: checkupBody(checkup),
    actions: [SEE],
    refs: { insuranceCheckupId: checkup.id, advice: true },
  };
}

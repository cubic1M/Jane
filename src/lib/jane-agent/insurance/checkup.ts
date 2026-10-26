import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { runCheckup } from "@/lib/insurance/checkups";
import type { Reply } from "../replies";
import { checkupBody } from "./checkup-words";

// The coverage checkup in Jane's chat (spec step 106): the same words for the message Jane
// posts on its own and for "check my insurance". Demo advice: always labelled.

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

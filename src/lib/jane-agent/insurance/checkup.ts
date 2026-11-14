import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { addPolicyHref } from "@/lib/insurance/add-link";
import { runCheckup } from "@/lib/insurance/checkups";
import type { Reply } from "../replies";
import { checkupBody } from "./checkup-words";
import { openLink } from "../types";

// The coverage checkup in Jane's chat (spec step 106): the same words for the message Jane
// posts on its own and for "check my insurance". Demo advice: always labelled.

const SEE = openLink("See the checkup", "/insurance/checkup");

// "Check my insurance": runs the checkup now, in demo advice mode only.
export async function checkupAnswer(
  userId: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<Reply> {
  if (!(await adviceMode(userId, { client }))) {
    return {
      body: "Checking whether you have the right amount of cover means recommending changes, which I only do with demo data for now. I can still tell you what each policy covers and what looks missing.",
      actions: [openLink("See your insurance", "/insurance")],
      refs: {},
    };
  }
  const checkup = await runCheckup(userId, "asked", { client, now });
  if (!checkup) {
    return {
      body: "I don't have any of your policies yet, so there's nothing to check. Add them and I'll check your cover.",
      actions: [openLink("Add a policy", addPolicyHref())],
      refs: {},
    };
  }
  return {
    body: checkupBody(checkup),
    actions: [SEE],
    refs: { insuranceCheckupId: checkup.id, advice: true },
  };
}

import type { Reply } from "../replies";
import { checkupAnswer } from "../insurance/checkup";
import { autopilotAnswer } from "../insurance/autopilot";
import { benefitsAnswer } from "../insurance/benefits";
import { readingsAnswer } from "../insurance/readings";
import { cardCoverAnswer } from "../insurance/card-cover";
import { lifeAnswer } from "../insurance/life";
import { lifeChangeAnswer } from "../insurance/cover-changes";
import { fileClaimAnswer, renewalCallAnswer } from "../insurance/done-by-jane";
import type { CoverEvent } from "@/config/insurance";
import { claimAnswer } from "../insurance/claim";
import { quotesAnswer } from "../insurance/quotes";
import { savingsAnswer } from "../insurance/savings";
import { risksAnswer } from "../insurance/risks";
import { familyAnswer } from "../insurance/family";
import { claimWorthAnswer } from "../insurance/claim-worth";
import { insuranceReply } from "../insurance/replies";
import { loadInsuranceSnapshot } from "../insurance/snapshot";
import { type CapabilityContext } from "./shared";

// Insurance (spec step 190): the rules' answers for these kinds of question, one registered
// capability each in ./index.ts. Moved out of ../answer.ts unchanged.

async function answer(ctx: CapabilityContext): Promise<Reply | null> {
  const { intent } = ctx;
  const { userId, client, now, asOf } = ctx;

  switch (intent.kind) {
    case "insurance":
      // Spec step 103: quotes ask the partner, the rest read the profile.
      if (intent.ask === "quotes") return quotesAnswer(userId, intent, { client, now });
      // Spec step 106: the coverage checkup, run when asked.
      if (intent.ask === "checkup") return checkupAnswer(userId, { client, now });
      // Spec step 107: something happened.
      if (intent.ask === "claim") return claimAnswer(userId, intent, { client, now });
      // Spec step 108: what Jane does with insurance by herself.
      if (intent.ask === "autopilot") return autopilotAnswer(userId, { client });
      // Spec step 150: cover through work.
      if (intent.ask === "benefits") return benefitsAnswer(userId, { client, now });
      // Spec step 151: policies read from documents.
      if (intent.ask === "documents") return readingsAnswer(userId, { client, now });
      // Spec step 152: cover that comes with their cards.
      if (intent.ask === "cards") return cardCoverAnswer(userId, { client });
      // Spec step 153: life cover sized and applied for.
      if (intent.ask === "life") return lifeAnswer(userId, { client, now });
      // Spec step 154: a life change told to Jane.
      // Spec step 155: renewal calls and claims done by Jane.
      if (intent.ask === "renewal_call") return renewalCallAnswer(userId, { client, now });
      if (intent.ask === "file_claim") return fileClaimAnswer(userId, { client, now });
      // Spec step 196: cheaper ways to pay for the same cover.
      if (intent.ask === "savings") return savingsAnswer(userId, { client, now });
      // Spec step 197: risks seen in how they live.
      if (intent.ask === "risks") return risksAnswer(userId, { client, now });
      // Spec step 198: the whole household's cover.
      if (intent.ask === "household") return familyAnswer(userId, { client, now });
      // Spec step 199: claim or pay yourself?
      if (intent.ask === "claim_worth") {
        return claimWorthAnswer(
          userId,
          { amountCents: intent.amountCents, kind: intent.policyKind, event: intent.event },
          { client },
        );
      }
      if (intent.ask === "life_change") {
        return lifeChangeAnswer(userId, intent.event as CoverEvent, { client, now });
      }
      return insuranceReply(intent, await loadInsuranceSnapshot(userId, { client, now }), asOf);
    default:
      return null;
  }
}

export const insuranceAnswer = answer;

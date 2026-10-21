import type { Reply } from "../replies";
import { answerTaxIntent } from "../tax-answer";
import { DECISION_CONFIDENCE } from "@/config/tax-decisions";
import { decideTax } from "@/lib/tax-decisions";
import { parseTaxIntent } from "../tax-intents";
import { type Capability, type CapabilityContext } from "./shared";

// Taxes (spec step 190): the rules' answers for these kinds of question, one registered
// capability each in ./index.ts. Moved out of ../answer.ts unchanged.

async function answer(ctx: CapabilityContext): Promise<Reply | null> {
  const { intent } = ctx;
  const { userId, client, now } = ctx;

  switch (intent.kind) {
    case "tax":
      return answerTaxIntent(userId, intent, { client, now });
    default:
      return null;
  }
}

export const taxAnswer = answer;

// "Should I ...?" about taxes (docs/decisions.md): the router hands over the words after
// "should I"; the tax rules read them the same way a direct question is read.
export const taxDecide: NonNullable<Capability["decide"]> = async ({
  userId,
  client,
  now,
  label,
}) => {
  const intent = parseTaxIntent(`should i ${label}`);
  if (!intent || intent.kind !== "tax" || intent.ask !== "decide") return null;
  const d = await decideTax(userId, intent.topic, { client, now });
  return {
    body: d.text,
    actions: [{ id: "open", label: "See the numbers", kind: "link", href: d.href }],
    confidence: DECISION_CONFIDENCE,
    refs: d.advice ? { advice: true } : undefined,
  };
};

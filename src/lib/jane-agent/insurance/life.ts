import type { PrismaClient } from "@/generated/prisma/client";
import { sizeLife } from "@/lib/insurance/life";
import { chatToday, timezoneOf } from "@/lib/today";
import type { Reply } from "../replies";
import {
  DEPENDANTS_QUESTION,
  LIFE_LINK,
  NOT_NEEDED,
  askingStep,
  decisionStep,
  sizedActions,
  sizedBody,
} from "./life-words";
import { openLink } from "../types";

// "How much life insurance do I need?" (spec step 153): sized now from the person's
// numbers, with the method and the best quote, as demo advice. Real accounts get no
// amount: that's advice, which Jane only gives on the demo bank's sample data.

export async function lifeAnswer(
  userId: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<Reply> {
  const asOf = await chatToday(userId, { client, now });
  const sized = await sizeLife(userId, { client, now, asked: true });
  switch (sized.kind) {
    case "no_advice":
      return {
        body: "I can't tell you how much life insurance to get on your real accounts yet: that's advice, and I'll only give it once a licensed partner is connected. I can show you what you have on your insurance page.",
        actions: [openLink("Your insurance", "/insurance")],
        refs: {},
      };
    case "ask_dependants":
      return { ...DEPENDANTS_QUESTION, refs: {} };
    case "not_needed":
      return {
        body: NOT_NEEDED[sized.reason].replace(/^Thanks\. /, ""),
        actions: [LIFE_LINK],
        refs: {},
      };
    case "dismissed":
      return {
        body: "You told me not now. Ask me again any time.",
        actions: [LIFE_LINK],
        refs: {},
      };
    case "sized":
      return {
        body: sizedBody(sized.application, asOf),
        actions: sizedActions(sized.application, asOf),
        refs: { lifeApplicationId: sized.application.id, advice: true },
      };
    case "in_progress": {
      const application = sized.application;
      const step =
        application.status === "asking"
          ? askingStep(application)
          : decisionStep(application, await timezoneOf(userId, { client }));
      return { ...step, refs: { lifeApplicationId: application.id, advice: true } };
    }
  }
}

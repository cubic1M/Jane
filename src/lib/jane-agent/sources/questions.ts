import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import type { ActionId } from "../types";
import type { MessageSource } from "./source";

// The one question worth asking (spec step 257): a fact Jane's checks need and the data can't
// show, asked once with tap answers, the one that would unlock the most first. The fifth
// button skips. Answers go into the profile (src/lib/questions.ts).
export const questionsSource: MessageSource = {
  key: "questions",
  gather(snapshot) {
    const q = snapshot.question;
    if (!q) return [];
    return [
      {
        kind: "decision" as const,
        body: `${q.text} It helps me work out what's worth doing for you, and I won't ask again.`,
        refs: { askFact: q.fact },
        actions: [
          ...q.choices.map((c, i) => ({
            id: `ask.answer.${i + 1}` as ActionId,
            label: c.label,
            kind: "secondary" as const,
          })),
          { id: "ask.answer.5" as const, label: "Skip", kind: "secondary" as const },
        ],
        dedupeKey: q.fact,
        priority: MESSAGE_PRIORITY.questions,
      },
    ];
  },
};

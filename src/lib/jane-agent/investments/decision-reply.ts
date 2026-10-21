import type { DecisionKind } from "@/config/investing-decisions";
import { decide, type DecisionFacts } from "@/planning/investing-decision";
import type { Reply } from "../replies";
import type { MessageAction } from "../types";

// An investing decision as a chat reply: the answer in three sentences or fewer, a link to the
// page behind it, and the crypto connect offer only as an optional button after the answer.

const LINK: MessageAction = {
  id: "open",
  label: "See your investments",
  kind: "link",
  href: "/investments",
};

export function decisionReply(
  kind: DecisionKind,
  facts: DecisionFacts,
  subject: string | null,
): Reply {
  const asked = kind === "retire_at" && subject ? Number(subject) : null;
  const { sentences, offerCrypto } = decide(
    kind,
    { ...facts, askedAge: Number.isFinite(asked) ? asked : null },
    subject,
  );
  return {
    body: sentences.join(" "),
    actions: [
      ...(offerCrypto && facts.advice
        ? [
            {
              id: "crypto.link" as const,
              label: "Connect a demo exchange (read-only)",
              kind: "secondary" as const,
            },
          ]
        : []),
      LINK,
    ],
    refs: facts.advice ? { advice: true } : {},
  };
}

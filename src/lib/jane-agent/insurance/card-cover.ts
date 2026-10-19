import type { PrismaClient } from "@/generated/prisma/client";
import { cardCover, conditionWords, limitWords } from "@/lib/insurance/card-cover";
import { formatCents } from "@/lib/money";
import type { Reply } from "../replies";
import type { MessageAction } from "../types";

// "Does my card cover my phone?" (spec step 152): the cover the person's cards come with,
// with the limits and what they have to do for it to apply, and any plan they pay for
// twice. Cancelling one is the finding's own Yes.

const INSURANCE: MessageAction = {
  id: "open",
  label: "Your insurance",
  kind: "link",
  href: "/insurance#cards",
};

export async function cardCoverAnswer(
  userId: string,
  { client }: { client: PrismaClient },
): Promise<Reply> {
  const { cards, duplicates } = await cardCover(userId, { client });
  const open = duplicates.filter((d) => d.status === "new" || d.status === "shown");
  if (cards.length === 0) {
    return {
      body: "I don't know of cover that comes with your cards yet. I only count a card's cover once our team has checked its benefit guide, so I won't tell you to cancel anything on a guess.",
      actions: [INSURANCE],
      refs: {},
    };
  }
  const lines: string[] = [];
  if (open.length > 0) {
    const [first] = open;
    lines.push(
      `You're paying twice: your ${first.card} already gives you ${first.benefit.toLowerCase()}, and you also pay ${first.merchant}${first.annualSavingsCents ? ` ${formatCents(first.annualSavingsCents)} a year` : ""}.`,
    );
  } else {
    lines.push(
      `Your ${cards.map((c) => c.card).join(" and ")} ${cards.length === 1 ? "comes" : "come"} with cover, and nothing you pay for duplicates it.`,
    );
  }
  for (const card of cards) {
    for (const b of card.benefits) {
      lines.push(`- ${b.label}: ${limitWords(b)}, when ${conditionWords(b)}`);
    }
  }
  return {
    body: lines.join("\n"),
    actions: [
      ...open.slice(0, 2).map((d): MessageAction => ({
        id: "open",
        label: `Cancel ${d.merchant}`,
        kind: "link",
        href: `/report/${d.findingId}`,
      })),
      INSURANCE,
    ],
    refs: {},
  };
}

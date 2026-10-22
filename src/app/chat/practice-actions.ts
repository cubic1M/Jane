"use server";

import { dismissPracticeCard } from "@/lib/practice/cards";
import { requireUser } from "@/lib/session";

// Puts a practice portfolio card away for the signed-in person (spec step 296). It changes
// nothing in the portfolio.
export async function putAwayPracticeCard(cardId: string): Promise<void> {
  const user = await requireUser();
  if (typeof cardId !== "string" || cardId.length > 100) return;
  await dismissPracticeCard(user.id, cardId);
}

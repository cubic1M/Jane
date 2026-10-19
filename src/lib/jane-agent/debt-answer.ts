import type { PrismaClient } from "@/generated/prisma/client";
import { loadDebts } from "@/lib/debts";
import type { DebtIntent } from "./debt-intents";
import { debtReply } from "./debt-replies";
import type { Reply } from "./replies";

// Answers questions about debts by rules (spec Phase Y), with the same loaders as the
// pages, scoped to the person. Called from ./answer.ts.
export async function answerDebt(
  userId: string,
  intent: DebtIntent,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<Reply> {
  switch (intent.kind) {
    case "debts":
    case "debt_detail":
      return debtReply(intent, await loadDebts(userId, { client, now }));
  }
}

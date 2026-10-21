import { INSIGHT_MONTHS } from "@/config/insights";
import type { PrismaClient } from "@/generated/prisma/client";
import { loadInsightTransactions } from "@/insights/load";
import { CATEGORY_LABELS, UNCATEGORIZED } from "@/insights/labels";
import { scopedFor } from "@/lib/db-scoped";
import type { Decider } from "../decision";
import type { Intent } from "../intents";
import type { Reply } from "../replies";
import { spendingReply } from "../replies";

// What a registered capability (./index.ts) works with (spec step 190).

export type CapabilityContext = {
  userId: string;
  intent: Intent;
  client: PrismaClient;
  now: Date;
  // Today, YYYY-MM-DD.
  asOf: string;
  // Answers another intent by the rules (a plan is made of the answers to its parts).
  ask: (intent: Intent) => Promise<Reply | null>;
};

// One thing Jane can do for a question: the kinds of intent it answers, the answer, and the
// tools Claude has for it. The test in ../registry.test.ts holds each to its bank questions
// and to one claim on each kind. Adding one: a file here (or its feature's own) and a line
// in ./index.ts.
export type Capability = {
  id: string;
  // The bank's sectors (src/lib/jane-agent/checks/bank-more.ts) that test it.
  bank: readonly string[];
  // The intent kinds it answers.
  kinds: readonly Intent["kind"][];
  // Claude's tools for the same questions (src/lib/jane-agent/claude-tools.ts).
  tools: readonly string[];
  answer: (context: CapabilityContext) => Promise<Reply | null>;
  // "Should I ...?" (docs/decisions.md): the subjects this capability decides, and how. The
  // core router (../decision.ts) hands a decision question to the capability that lists its
  // subject; one it declines (null), or that nobody claims, gets the general answer.
  decides?: Decider["decides"];
  decide?: Decider["decide"];
};

export const CATEGORY_LIST = [...new Set([...Object.values(CATEGORY_LABELS), UNCATEGORIZED])];

// What was spent in one category this month (when a name isn't a regular charge).
export async function spendingIn(
  { userId, client, asOf }: CapabilityContext,
  category: string,
): Promise<Reply> {
  return spendingReply(
    { kind: "spending", category, month: asOf.slice(0, 7) },
    await loadInsightTransactions(scopedFor(userId, client), asOf, INSIGHT_MONTHS),
    asOf,
  );
}

import { SAMPLE_DRAFT_NAME } from "@/config/documents";
import { cache } from "react";
import { REAL_ACCOUNT_ADVICE } from "@/config/advice";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { isDemoOnly } from "@/lib/digest/recipients";
import { isSampleTrialUser, isStatementTrialUser } from "@/lib/trial-ids";
import { cachedRead } from "@/lib/read-cache";

// Demo advice mode (spec step 98): whether Jane may give this person recommendations on
// investments, taxes, insurance and loans. Only when every account they have comes from the
// demo bank, so a real account never gets advice: a real bank or a CSV import next to the
// demo bank turns it off. Outside production it's on for demo-bank people; in production
// only with DEMO_ADVICE=1, or for a trial person (spec step 138). Everything shown in this
// mode carries DEMO_ADVICE_LABEL.

export function demoAdviceAllowed(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.DEMO_ADVICE === "1";
}

export async function adviceMode(
  userId: string,
  { client = defaultClient }: { client?: PrismaClient } = {},
): Promise<boolean> {
  return client === defaultClient
    ? adviceModeOnce(userId)
    : cachedRead(`adviceMode:${userId}`, client, () => adviceModeFrom(userId, client));
}

// Worked out once per server render (React's cache): a page's parts each ask (speed pass,
// 2026-10-24: /home asked 81 times).
const adviceModeOnce = cache((userId: string) => adviceModeFrom(userId, defaultClient));

// Every account this person has comes from the demo bank, so all they see is sample data.
export async function onlyDemoBank(userId: string, client: PrismaClient): Promise<boolean> {
  const db = scopedFor(userId, client);
  const [items, csvAccounts] = await Promise.all([
    db.plaidItems.findMany({ select: { plaidItemId: true } }),
    db.accounts.count({ where: { source: "csv" } }),
  ]);
  return isDemoOnly(
    items.map((i) => i.plaidItemId),
    csvAccounts,
  );
}

export async function hasOwnDocument(userId: string, client: PrismaClient): Promise<boolean> {
  const own = await scopedFor(userId, client).documents.count({
    where: { fileName: { not: SAMPLE_DRAFT_NAME }, extractionSource: { not: "partner" } },
  });
  return own > 0;
}

async function adviceModeFrom(userId: string, client: PrismaClient): Promise<boolean> {
  // Someone's own statement (src/lib/statement-trial.ts) is real data, whatever else is there.
  if (isStatementTrialUser(userId)) return REAL_ACCOUNT_ADVICE;
  // Real data: off until REAL_ACCOUNT_ADVICE says otherwise (it doesn't).
  if (!(await onlyDemoBank(userId, client))) return REAL_ACCOUNT_ADVICE;
  // So is a document of their own, whichever came first: documents/actions.ts stops one going up
  // once advice is on, but linking the demo bank afterwards or removing a real bank would turn
  // advice on with it already on file. The sample draft and a demo switch's papers aren't theirs.
  if (await hasOwnDocument(userId, client)) return REAL_ACCOUNT_ADVICE;
  // Spec step 138: a trial person is sample data by construction, so always.
  return isSampleTrialUser(userId) || demoAdviceAllowed();
}

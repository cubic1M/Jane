"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { canImportCsv } from "@/lib/csv-access";
import { scopedDb } from "@/lib/db-scoped";
import { setBrokerageBalance } from "@/lib/investing/brokerage-balance";
import { runJob } from "@/lib/jobs";
import { parseMoneyToCents } from "@/lib/money";
import { requireUser } from "@/lib/session";

// "What's in your Robinhood account today?" on /investments (read-only beta). The answer is the
// signed-in person's own typed balance; the numbers follow in the background.

export type BrokerageResult = { ok: true } | { ok: false; error: string };

export async function setBrokerageBalanceAction(
  app: string,
  text: string,
): Promise<BrokerageResult> {
  const user = await requireUser();
  if (!canImportCsv(user)) return { ok: false, error: "Uploads aren't on for your account." };
  const cents = parseMoneyToCents(text.trim());
  if (cents === null || cents < 0) {
    return { ok: false, error: "Enter the amount as a number, like 1,234.56." };
  }
  const set = await setBrokerageBalance(await scopedDb(), app, cents);
  if (!set) return { ok: false, error: "Jane doesn't know that account." };
  after(() => runJob(set.jobId).then(() => undefined));
  revalidatePath("/investments");
  return { ok: true };
}

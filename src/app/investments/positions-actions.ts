"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { decodeStatement } from "@/data-sources/csv/decode";
import { canImportCsv } from "@/lib/csv-access";
import { scopedDb } from "@/lib/db-scoped";
import { importPositionsText, MAX_POSITION_BYTES } from "@/lib/investing/positions-import";
import { runJob } from "@/lib/jobs";
import { requireUser } from "@/lib/session";

// "Add what you own": a brokerage positions file on /investments (read-only beta). Read in memory,
// never stored; the holdings and the account's balance are the signed-in person's own.

export type PositionsActionResult =
  | { ok: true; accounts: { name: string; holdings: number; valueCents: number }[] }
  | { ok: false; error: string };

export async function importPositionsAction(formData: FormData): Promise<PositionsActionResult> {
  const user = await requireUser();
  if (!canImportCsv(user)) return { ok: false, error: "Uploads aren't on for your account." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    return { ok: false, error: "Choose a file first." };
  if (file.size > MAX_POSITION_BYTES)
    return { ok: false, error: "That file is too big to be a positions list." };
  const result = await importPositionsText(
    await scopedDb(),
    decodeStatement(await file.arrayBuffer()),
  );
  if (!result.ok) return result;
  if (result.jobId) after(() => runJob(result.jobId).then(() => undefined));
  revalidatePath("/investments");
  return { ok: true, accounts: result.accounts };
}

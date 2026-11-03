import {
  STATEMENT_TRIAL_STUCK_ATTEMPTS,
  STATEMENT_TRIAL_STUCK_MINUTES,
} from "@/config/statement-trial";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { systemDb } from "@/lib/system-db";
import { runJob, type Handlers } from "@/lib/jobs";

// An upload's work runs after the response, on a server that can be cut off. Nothing else would
// pick it up before the daily cron, by when a temporary try's session has ended and the chip has
// said "Importing…" for a day. So while the chip asks how it's going
// (src/app/api/import/status/route.ts), a job lost with its server goes back in the queue, and one
// lost twice is called what it is. The caller only comes here for a temporary try.
export async function rescueStuckTry(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    handlers,
  }: { client?: PrismaClient; now?: Date; handlers?: Handlers } = {},
): Promise<"none" | "retried" | "failed"> {
  const system = systemDb(
    "The jobs table has no owner: one person's upload job, by its payload",
    client,
  );
  const stuckBefore = new Date(now.getTime() - STATEMENT_TRIAL_STUCK_MINUTES * 60_000);
  const gaveUp = await system.$queryRaw<{ run: string | null }[]>`
    UPDATE jobs SET status = 'failed', last_error = 'Lost twice', updated_at = ${now}
    WHERE kind = 'import_finish' AND status = 'running' AND payload->>'userId' = ${userId}
      AND updated_at < ${stuckBefore} AND attempts >= ${STATEMENT_TRIAL_STUCK_ATTEMPTS}
    RETURNING payload->>'importRunId' AS run`;
  for (const { run } of gaveUp) {
    if (run) {
      await scopedFor(userId, client).importRuns.updateMany({
        where: { id: run },
        data: { stage: "failed" },
      });
    }
  }
  await system.$executeRaw`
    UPDATE jobs SET status = 'queued', run_at = ${now}, updated_at = ${now}
    WHERE kind = 'import_finish' AND status = 'running' AND payload->>'userId' = ${userId}
      AND updated_at < ${stuckBefore}`;
  const [due] = await system.$queryRaw<{ id: string }[]>`
    SELECT id FROM jobs
    WHERE kind = 'import_finish' AND status = 'queued' AND run_at <= ${now}
      AND payload->>'userId' = ${userId}
    ORDER BY run_at LIMIT 1`;
  if (due) {
    await runJob(due.id, { client, now, ...(handlers ? { handlers } : {}) });
    return "retried";
  }
  return gaveUp.length > 0 ? "failed" : "none";
}

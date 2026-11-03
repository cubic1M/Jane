import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { db } from "@/lib/db";
import { alertError } from "@/lib/error-alerts";
import { recordRun } from "@/lib/health";
import { runInvariants } from "@/lib/invariants/nightly";
import { log } from "@/lib/log";

export const maxDuration = 120;

// Vercel Cron, daily after the banks' sync: what must hold on live data, in counts only
// (src/lib/invariants/nightly.ts). A count that must be 0 and isn't emails the team, by its name.
export async function GET(request: Request) {
  if (!cronAuthorized(request, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const summary = await recordRun("invariants", () => runInvariants());
  log.info("Nightly invariants", { ...summary });
  if (summary.broken.length > 0) {
    await alertError(
      { message: `Nightly invariants: ${summary.broken.join(", ")}`, path: "/api/cron/invariants" },
      { client: db },
    );
  }
  return NextResponse.json(summary);
}

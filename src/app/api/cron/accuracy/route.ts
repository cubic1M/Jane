import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { recordRun } from "@/lib/health";
import { ACCURACY_JOB, runAccuracyChecks } from "@/lib/invariants/accuracy";
import { log } from "@/lib/log";

export const maxDuration = 300;

// Vercel Cron, daily after the banks' sync and the nightly invariants: every real person's figures
// against what must hold (src/lib/invariants/accuracy.ts), in counts only. The digest job's health
// email sends what failed, by check name (src/lib/invariants/accuracy-email.ts).
export async function GET(request: Request) {
  if (!cronAuthorized(request, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const summary = await recordRun(ACCURACY_JOB, () => runAccuracyChecks());
  log.info("Accuracy checks", {
    people: summary.people,
    checked: summary.checked,
    failing: summary.failing,
  });
  return NextResponse.json(summary);
}

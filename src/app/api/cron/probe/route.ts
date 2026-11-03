import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { db } from "@/lib/db";
import { alertError } from "@/lib/error-alerts";
import { describeError, recordError } from "@/lib/error-log";
import { recordRun } from "@/lib/health";
import { ProbeFailed, runProbe } from "@/lib/probe";
import { siteOrigin } from "@/lib/site-origin";

export const maxDuration = 120;

// The hourly sign-in and cross-user check (src/lib/probe.ts), started by
// .github/workflows/probe.yml with "Authorization: Bearer $PROBE_SECRET". Vercel Hobby can't run a
// cron hourly. Without PROBE_SECRET it refuses everyone, so nothing runs until a founder sets it.
export async function GET(request: Request) {
  if (!cronAuthorized(request, process.env.PROBE_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // The probe sends its sample person's session here, so the site's own address where it's known.
  const base = siteOrigin() ?? new URL(request.url).origin;
  try {
    const result = await recordRun("probe", async () => {
      const outcome = await runProbe(base);
      if (!outcome.ok) throw new ProbeFailed(outcome);
      return outcome;
    });
    return NextResponse.json(result);
  } catch (error) {
    if (!(error instanceof ProbeFailed)) throw error;
    const path = "/api/cron/probe";
    await recordError(error, { path, method: "GET", routeType: "route" }, db);
    await alertError({ message: describeError(error).message, path }, { client: db });
    return NextResponse.json(error.result, { status: 503 });
  }
}

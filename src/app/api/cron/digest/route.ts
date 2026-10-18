import { NextResponse } from "next/server";
import { runMonthlyCheckIns } from "@/lib/check-in-email";
import { runDigests } from "@/lib/digest/send";
import { recordRun, reportMissedJobs } from "@/lib/health";
import { runDueJobs } from "@/lib/jobs";
import { runPlanTexts } from "@/lib/messaging/texts";

// Vercel Cron, daily: sends this week's digest to anyone whose Monday has arrived. With
// ?dry_run=1 it renders every digest and returns them without sending or storing.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = new URL(request.url).searchParams.get("dry_run") === "1";
  if (dryRun) return NextResponse.json(await runDigests({ dryRun }));
  try {
    await reportMissedJobs();
  } catch (error) {
    console.error("Health check failed", { error: String(error) });
  }
  return NextResponse.json(
    await recordRun("digest", async () => {
      const run = await runDigests({ dryRun });
      return {
        ...run,
        previews: undefined,
        checkIns: await runMonthlyCheckIns(),
        // The weekly plan by text, for people who turned it on (spec step 78). A problem
        // there never stops the rest of the run.
        planTexts: await runPlanTexts().catch((error) => {
          console.error("Plan texts failed", { error: String(error) });
          return null;
        }),
        // A second daily chance for jobs waiting to be retried.
        jobs: await runDueJobs(),
      };
    }),
  );
}

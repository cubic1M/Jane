import { NextResponse } from "next/server";
import { runDigests } from "@/lib/digest/send";
import { sendErrorDigest } from "@/lib/error-alerts";
import { recordRun, reportMissedJobs } from "@/lib/health";
import { runDueJobs } from "@/lib/jobs";
import { runJaneAgentForAll } from "@/lib/jane-agent/run";
import { runMonthlyReports } from "@/lib/monthly-report";
import { runNews } from "@/lib/news/store";

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
  // Once a day: the last day's server errors, counted by kind (src/lib/error-alerts.ts).
  try {
    await sendErrorDigest();
  } catch (error) {
    console.error("Error digest failed", { error: String(error) });
  }
  return NextResponse.json(
    await recordRun("digest", async () => {
      const run = await runDigests({ dryRun });
      return {
        ...run,
        previews: undefined,
        // Spec step 148: last month's money report, once, in the first days of the month. It is
        // the one monthly email: the check-in (spec step 45) is part of it.
        monthlyReports: await runMonthlyReports().catch((error) => {
          console.error("Monthly reports failed", { error: String(error) });
          return null;
        }),
        // Jane's daily look at everyone's money, in the chat (spec step 82). A problem
        // there never stops the rest of the run.
        chat: await runJaneAgentForAll().catch((error) => {
          console.error("Jane's daily chat run failed", { error: String(error) });
          return null;
        }),
        // Spec step 293: the watchlist's news, summarised in a few batched calls at most.
        news: await runNews().catch((error) => {
          console.error("News summaries failed", { error: String(error) });
          return null;
        }),
        // A second daily chance for jobs waiting to be retried.
        jobs: await runDueJobs(),
      };
    }),
  );
}

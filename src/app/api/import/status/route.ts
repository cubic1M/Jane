import { NextResponse, after } from "next/server";
import { log } from "@/lib/log";
import { currentImportRun } from "@/lib/import/background";
import { getCurrentUser } from "@/lib/session";
import { isStatementTrialUser } from "@/lib/trial-ids";

// An upload picked up here again gets as long as it would have had (src/app/page.tsx).
export const maxDuration = 300;

// How the signed-in person's latest upload is getting on, for the progress chip on every page
// (src/components/import-chip.tsx): {"run": null} when there's nothing to show. Someone signed
// out gets that too, not a 401: the chip is on every page, /, /login and /goodbye included, and
// a 401 there was a console error on each visit (first-user walk after "Delete all my data").
export async function GET() {
  const user = await getCurrentUser();
  const run = user ? await currentImportRun(user.id) : null;
  // A temporary try can't wait for the daily cron if its upload's server was cut off. After the
  // response, and loaded only here: this route is polled from every page.
  if (user && run && run.stage !== "done" && isStatementTrialUser(user.id)) {
    after(() =>
      import("@/lib/statement-trial-rescue")
        .then((m) => m.rescueStuckTry(user.id))
        .catch((error) =>
          log.error("Rescuing a temporary try's upload failed", {
            error: error instanceof Error ? error.name : "unknown",
          }),
        ),
    );
  }
  // A temporary try's chip has its own words if it fails: nobody retries it once the person leaves.
  const shown = run && user && isStatementTrialUser(user.id) ? { ...run, temporary: true } : run;
  return NextResponse.json({ run: shown }, { headers: { "cache-control": "no-store" } });
}

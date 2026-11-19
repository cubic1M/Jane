import { NextResponse } from "next/server";
import { GMAIL_LIMITS } from "@/config/gmail";
import { cronAuthorized } from "@/lib/cron-auth";
import { refreshAllGmail } from "@/lib/gmail/sync";
import { recordRun } from "@/lib/health";
import { freshSwitches } from "@/lib/ops-switches";

// Vercel Cron, daily: reads the Gmail mailboxes due a read (src/lib/gmail/sync.ts), the backstop
// for notices from Google that didn't come, and the only reader when notices are off. Its own route,
// so a slow mailbox or a slow Claude can't hold up the nightly bank sync, and the bank sync can't
// leave mail no time. Off (GMAIL_LINK unset, or KILL_BANKS) it reads nothing and says so. Vercel
// sends "Authorization: Bearer $CRON_SECRET".
// GMAIL_LIMITS.cronBudgetMs stops new mailboxes in time for the last one, and the calls it is still
// waiting on, to end inside this limit (route.test.ts adds it up).
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!cronAuthorized(request, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await freshSwitches();
  const summary = await recordRun("gmail", () =>
    refreshAllGmail({ budgetMs: GMAIL_LIMITS.cronBudgetMs }),
  );
  return NextResponse.json(summary ?? { off: true });
}

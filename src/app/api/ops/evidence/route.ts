import { NextResponse } from "next/server";
import { buildCommit } from "@/config/build-commit";
import { cronAuthorized } from "@/lib/cron-auth";
import { jobStates, recentErrors } from "@/lib/ops-invariants";
import { switchesOn } from "@/lib/ops-switches";

// What the reader agent reads when something fires (scripts/ops/reader.mjs). Read-only. A secret of
// its own, which can do nothing else, so a reader that's been talked into something has nothing to
// do it with.
export async function GET(request: Request) {
  if (!cronAuthorized(request, process.env.OPS_READ_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    commit: buildCommit(),
    jobs: await jobStates(),
    switches: await switchesOn(),
    errors: await recentErrors(),
  });
}

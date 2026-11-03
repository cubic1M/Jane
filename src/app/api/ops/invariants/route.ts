import { NextResponse } from "next/server";
import { buildCommit } from "@/config/build-commit";
import { cronAuthorized } from "@/lib/cron-auth";
import { jobStates } from "@/lib/ops-invariants";
import { switchesOn } from "@/lib/ops-switches";

// What the watch reads on its timer: counts, names and times, never a person's data or an error's
// words. Read-only, with a secret of its own that can do nothing else.
export async function GET(request: Request) {
  if (!cronAuthorized(request, process.env.OPS_READ_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    commit: buildCommit(),
    jobs: await jobStates(),
    switches: await switchesOn(),
  });
}

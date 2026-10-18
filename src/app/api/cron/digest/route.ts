import { NextResponse } from "next/server";
import { runDigests } from "@/lib/digest/send";

// Vercel Cron, daily: sends this week's digest to anyone whose Monday has arrived. With
// ?dry_run=1 it renders every digest and returns them without sending or storing.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = new URL(request.url).searchParams.get("dry_run") === "1";
  const run = await runDigests({ dryRun });
  return NextResponse.json(dryRun ? run : { ...run, previews: undefined });
}

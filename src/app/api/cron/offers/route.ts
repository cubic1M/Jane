import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { recordRun } from "@/lib/health";
import { refreshDueOffers } from "@/lib/offers/catalog";

// The offers catalog's refresher (src/lib/offers/catalog.ts): each source read on its own cadence
// (src/config/offers.ts). Called every hour by .github/workflows/probe.yml with PROBE_SECRET (Vercel
// Hobby runs a cron only daily) and daily by Vercel Cron with CRON_SECRET as the backstop. A source
// read recently is skipped, so an extra call costs one database read.
export const maxDuration = 120;

export async function GET(request: Request) {
  const hourly = cronAuthorized(request, process.env.PROBE_SECRET);
  if (!cronAuthorized(request, process.env.CRON_SECRET)) {
    if (!hourly) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const results = await recordRun("offers", () => refreshDueOffers());
  return NextResponse.json({
    sources: results.length,
    changed: results.reduce((n, r) => n + r.changed.length, 0),
    quarantined: results.reduce((n, r) => n + r.quarantined.length, 0),
  });
}

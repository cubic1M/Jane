import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { recordRun } from "@/lib/health";
import { matchOffers } from "@/lib/live/watches";
import { refreshDueOffers } from "@/lib/offers/catalog";

// The offers catalog's refresher (src/lib/offers/catalog.ts): each source read on its own cadence
// (src/config/offers.ts). Called every hour by .github/workflows/probe.yml with PROBE_SECRET (Vercel
// Hobby runs a cron only daily) and daily by Vercel Cron with CRON_SECRET as the backstop. A source
// read recently is skipped, so an extra call costs one database read. Then reverse matching
// (src/lib/live/watches.ts) scans again the people an offer now helps.
export const maxDuration = 120;

export async function GET(request: Request) {
  const hourly = cronAuthorized(request, process.env.PROBE_SECRET);
  if (!cronAuthorized(request, process.env.CRON_SECRET)) {
    if (!hourly) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const summary = await recordRun("offers", async () => {
    const results = await refreshDueOffers();
    // Then reverse matching: the people an offer now helps, found through their watches.
    const matches = await matchOffers();
    return {
      sources: results.length,
      changed: results.reduce((n, r) => n + r.changed.length, 0),
      quarantined: results.reduce((n, r) => n + r.quarantined.length, 0),
      ...matches,
    };
  });
  return NextResponse.json(summary);
}

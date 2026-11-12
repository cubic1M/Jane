import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { recordRun } from "@/lib/health";
import { log } from "@/lib/log";
import { matchOffers } from "@/lib/live/watches";
import { refreshDueOffers } from "@/lib/offers/catalog";

// The offers catalog's refresher (src/lib/offers/catalog.ts): each source read on its own cadence
// (src/config/offers.ts). Daily by Vercel Cron with CRON_SECRET (Hobby runs a cron only daily).
// Hourly by an outside pinger with OFFERS_PING_SECRET (cron-job.org, set up by a founder): a secret
// that opens this route only, so the pinger never holds CRON_SECRET. .github/workflows/probe.yml
// also calls it with PROBE_SECRET, but GitHub runs that schedule only every 6 to 9 hours. A source
// read recently is skipped, so an extra call costs one database read. Then reverse matching
// (src/lib/live/watches.ts) scans again the people an offer now helps.
export const maxDuration = 120;

export async function GET(request: Request) {
  const pinged =
    cronAuthorized(request, process.env.OFFERS_PING_SECRET) ||
    cronAuthorized(request, process.env.PROBE_SECRET);
  if (!cronAuthorized(request, process.env.CRON_SECRET)) {
    if (!pinged) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  log.info("offers_run", { by: pinged ? "ping" : "vercel_cron" });
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

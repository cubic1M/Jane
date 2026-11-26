import { NextResponse } from "next/server";
import { type SwitchTier, isKillSwitch, mayChange } from "@/config/kill-switches";
import { SYSTEM_ACTOR, logAudit } from "@/lib/audit";
import { cronAuthorized } from "@/lib/cron-auth";
import { alertError } from "@/lib/error-alerts";
import { log } from "@/lib/log";
import { setSwitch, switchesOn } from "@/lib/ops-switches";

const TIERS: readonly [SwitchTier, string][] = [
  ["founder", "OPS_FOUNDER_SECRET"],
  ["high_bar", "OPS_HIGH_BAR_SECRET"],
  ["reduce", "OPS_REDUCE_SECRET"],
];
const TRIGGER = /^[a-z0-9_-]{1,40}$/;

function tierOf(request: Request): SwitchTier | null {
  // Every secret is compared, so the time taken doesn't say which tier a guess came close to.
  const matched = TIERS.filter(([, name]) => cronAuthorized(request, process.env[name]));
  return matched[0]?.[0] ?? null;
}

// The emergency switches, for the watch (scripts/ops/watch.mjs) and for a founder with no Vercel
// login to hand. Three secrets, none set by default, so it refuses everyone until a founder sets
// them. See mayChange for what each may do. docs/incident.md.
export async function GET(request: Request) {
  if (!tierOf(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ on: await switchesOn() });
}

// The switch is set first, and stands: an emergency stop never waits on the audit log. A record
// that can't be written reaches the team instead, with what was switched.
async function record(name: string, on: boolean, how: { tier: SwitchTier; trigger: string }) {
  try {
    await logAudit(
      SYSTEM_ACTOR,
      "ops_switch_set",
      { type: "ops_switch", id: name },
      { on, ...how },
    );
  } catch (error) {
    const word = on ? "on" : "off";
    log.error("A switch change wasn't recorded", {
      switch: name,
      on,
      ...how,
      error: error instanceof Error ? error.name : "Error",
    });
    await alertError(
      {
        message: `SwitchNotRecorded: ${name} turned ${word}, with no audit record`,
        path: `/api/ops/switches/${name}-${word}`,
      },
      { pastCeiling: true },
    );
  }
}

export async function POST(request: Request) {
  const tier = tierOf(request);
  if (!tier) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    switch?: unknown;
    on?: unknown;
    trigger?: unknown;
  } | null;
  const { switch: name, on, trigger } = body ?? {};
  if (
    !isKillSwitch(name) ||
    typeof on !== "boolean" ||
    typeof trigger !== "string" ||
    !TRIGGER.test(trigger)
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!mayChange(tier, name, on)) {
    return NextResponse.json({ error: "Not with this secret" }, { status: 403 });
  }
  // Saying yes here while nothing reads the store would be the worst answer of all.
  if (process.env.OPS_SWITCHES !== "1") {
    return NextResponse.json({ error: "OPS_SWITCHES isn't on" }, { status: 409 });
  }
  const changed = await setSwitch(name, on, { tier, trigger });
  if (changed) await record(name, on, { tier, trigger });
  return NextResponse.json({ changed, on: await switchesOn() });
}

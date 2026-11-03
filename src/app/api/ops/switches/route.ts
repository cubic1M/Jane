import { NextResponse } from "next/server";
import { type SwitchTier, isKillSwitch, mayChange } from "@/config/kill-switches";
import { SYSTEM_ACTOR, logAudit } from "@/lib/audit";
import { cronAuthorized } from "@/lib/cron-auth";
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
  const changed = await setSwitch(name, on, { tier, trigger });
  if (changed) {
    await logAudit(
      SYSTEM_ACTOR,
      "ops_switch_set",
      { type: "ops_switch", id: name },
      { on, tier, trigger },
    );
  }
  return NextResponse.json({ changed, on: await switchesOn() });
}

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Gate C (mvp-ready.md), beside the moments scan in no-utc-days.test.ts: "today" is the person's
// day (todayOf, or todayFor with a scoped database; src/lib/today.ts), not UTC's. At 5pm in Los
// Angeles UTC's day is already tomorrow: a balance typed then was dated tomorrow, a payoff plan
// started a day late, a mortgage's months left and a tax pack's year moved at night, and a
// practice idea lapsed in the afternoon (#1972). A file may keep UTC's day only for a reason
// named here, and only as many times as listed, so a new one is looked at.

const SRC = join(__dirname, "..");
const UTC_TODAY =
  /isoDay\(now\)|now\.toISOString\(\)\.slice\(0, 10\)|new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/g;

const KEPT: Record<string, { uses: number; why: string }> = {
  // Nothing a person sees.
  "test-setup/sync-snapshots.ts": { uses: 2, why: "the test snapshots' cache key" },
  "app/admin/options/page.tsx": { uses: 1, why: "an admin page" },
  "app/admin/options/actions.ts": { uses: 1, why: "an admin page" },
  "lib/ops-alerts.ts": { uses: 1, why: "the founders' daily digest, once per UTC day" },
  "lib/error-alerts.ts": { uses: 2, why: "the founders' daily digest, once per UTC day" },
  "lib/invariants/accuracy-email.ts": { uses: 1, why: "the founders' daily email" },
  "lib/jane-agent/checks/proof.ts": { uses: 1, why: "the chat checks, on sample people" },
  "lib/jane-agent/checks/baseline.ts": { uses: 1, why: "the chat checks, on sample people" },
  "lib/jane-agent/checks/facts.ts": { uses: 1, why: "the chat checks, on sample people" },
  "lib/investments/strategy-today.ts": { uses: 1, why: "a memo's key, made again each day" },
  "lib/jane-agent/debt-intents.ts": { uses: 1, why: "a default every chat caller replaces" },
  "lib/jane-agent/replies.ts": { uses: 1, why: "a default every chat caller replaces" },
  "lib/connectors/credit-upload/upload.ts": {
    uses: 1,
    why: "behind CONNECTORS, which is off (#1877 may remove it)",
  },
  // Right as UTC.
  "lib/market-data/partner.ts": { uses: 1, why: "the market's last close" },
  "lib/practice/scan.ts": { uses: 1, why: "the market's day: prices to the close it runs at" },
  "lib/practice/ideas.ts": { uses: 1, why: "the market's day: a Yes fills at the latest close" },
  "lib/practice/broker.ts": {
    uses: 1,
    why: "the market's day: an order fills at the latest close",
  },
  "lib/practice/autopilot.ts": { uses: 2, why: "the market's day: prices and the day's trades" },
  "lib/investments/backtest.ts": { uses: 1, why: "the end of the price history" },
  "lib/investments/rule-replay.ts": { uses: 1, why: "the end of the price history" },
  "lib/plaid/sync.ts": { uses: 1, why: "Plaid's end date for a fetch, an upper bound" },
  "lib/plaid/demo.ts": { uses: 1, why: "the demo bank posts on its own day, as a bank does" },
  "lib/plaid/demo-history.ts": {
    uses: 1,
    why: "the demo bank posts on its own day, as a bank does",
  },
  "lib/snapshots.ts": { uses: 1, why: "the 10:00 UTC sync's day, the same day across the US" },
  "lib/insurance/demo-partner.ts": { uses: 3, why: "the stand-in insurer's own day" },
  "lib/compare.ts": { uses: 1, why: "the sample options' checked-on stamp, one for everyone" },
  "lib/evidence/orphans.ts": { uses: 1, why: "an upper bound; no line is dated later" },
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "generated" ? [] : files(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const uses = new Map(
  files(SRC).flatMap((path) => {
    const n = readFileSync(path, "utf8").match(UTC_TODAY)?.length ?? 0;
    return n > 0 ? [[relative(SRC, path), n] as const] : [];
  }),
);

describe("today", () => {
  it("is the person's own day, outside the files that keep UTC's for a reason", () => {
    expect([...uses.keys()].filter((file) => !KEPT[file]).sort()).toEqual([]);
  });

  it("is UTC's in the kept files only as often as listed", () => {
    const counts = Object.fromEntries(Object.keys(KEPT).map((f) => [f, uses.get(f) ?? 0]));
    expect(counts).toEqual(Object.fromEntries(Object.entries(KEPT).map(([f, k]) => [f, k.uses])));
  });
});

import { writeFileSync } from "node:fs";
import { it } from "vitest";
import { eventsDoc, evidenceSource, runAll } from "@/lib/events/__fixtures__/events-doc";

// Writes docs/backtests/events.md and src/config/event-evidence.ts from a fresh backtest of the
// events overlay. Research only: it runs when EVENTS_BACKTEST_OUT=1, never in CI; the check that
// both files still match a run is src/planning/event-evidence.test.ts.

it.runIf(process.env.EVENTS_BACKTEST_OUT === "1")("writes the events backtest", () => {
  const runs = runAll();
  writeFileSync("docs/backtests/events.md", eventsDoc(runs));
  writeFileSync("src/config/event-evidence.ts", evidenceSource(runs));
});

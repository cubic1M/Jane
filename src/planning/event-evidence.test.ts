import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EVENT_EVIDENCE,
  EVENT_EVIDENCE_RANGE,
  EVENT_EVIDENCE_CRYPTO,
  EVENT_EVIDENCE_SUMMARY,
} from "@/config/event-evidence";
import { eventsDoc, evidenceValues, runAll } from "@/lib/events/__fixtures__/events-doc";

// The events backtest's write-up and the record that seeds the paper account's confidence are
// what a fresh run gives: neither can drift from the code (docs/backtests/events.md).

describe("the events backtest's numbers", () => {
  const runs = runAll();
  it("match docs/backtests/events.md", () => {
    expect(readFileSync("docs/backtests/events.md", "utf8")).toBe(eventsDoc(runs));
  });
  it("match src/config/event-evidence.ts", () => {
    expect({
      EVENT_EVIDENCE,
      EVENT_EVIDENCE_RANGE,
      EVENT_EVIDENCE_SUMMARY,
      EVENT_EVIDENCE_CRYPTO,
    }).toEqual(evidenceValues(runs));
  });
});

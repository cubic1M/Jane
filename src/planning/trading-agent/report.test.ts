import { describe, expect, it } from "vitest";
import { AGENT_MARKETS } from "@/config/trading-agent";
import { timelineOf } from "./clock";
import { walkBars } from "./fixtures";
import { runGroup } from "./harness";
import { policiesFor } from "./policies";
import { evidenceOf, evidenceTs, intradayMarkdown, VERDICT_WORDS } from "./report";

// The write-up says how it was run, lists every strategy with its verdict (losers included),
// and never calls a replay a forecast.

const c = AGENT_MARKETS.crypto;
const btc = walkBars("BTC/USD", {
  from: "2024-01-01T00:00:00Z",
  count: 1_500,
  minutes: 60,
  vol: 0.012,
});
const eth = walkBars("ETH/USD", {
  from: "2024-01-01T00:00:00Z",
  count: 1_500,
  minutes: 60,
  vol: 0.015,
});
const tl = timelineOf({ "BTC/USD": btc, "ETH/USD": eth }, "BTC/USD", "24h");
const group = runGroup("crypto", "1h", policiesFor("crypto"), tl, c, c.cash, c.hold, 60)!;

describe("intradayMarkdown", () => {
  const md = intradayMarkdown([{ group, source: "made-up bars" }], { generatedOn: "2026-10-26" });

  it("has a row for every strategy with its verdict, and the counts add up", () => {
    for (const r of group.results) expect(md).toContain(`| ${r.label} |`);
    const losers = group.results.filter((r) => r.verdict === "loses_money").length;
    expect(md).toContain(`${losers} lost money`);
    for (const r of group.results) expect(md).toContain(VERDICT_WORDS[r.verdict]);
    expect(md).toContain("Bitcoin and ether, around the clock, every 1 hour");
  });

  it("says it is a replay and how the costs, gaps and haircut work", () => {
    expect(md).toContain("A replay of past bars, not a forecast");
    expect(md).toContain("next bar's open");
    expect(md).toContain("overnight and weekend gap");
    expect(md).toContain("deflated Sharpe ratio");
    expect(md.replaceAll("not a forecast", "")).not.toMatch(/forecast/i);
  });
});

describe("the evidence module", () => {
  it("keeps each strategy's out-of-sample figures and the setting to run", () => {
    const e = evidenceOf(group, "made-up bars");
    expect(e.rows).toHaveLength(group.results.length);
    expect(e.rows[0].param).toBe(group.results[0].chosen.at(-1));
    const ts = evidenceTs([e], "2026-10-26");
    expect(ts).toContain("export const INTRADAY_AGENT_EVIDENCE");
    expect(ts).toContain(e.rows[0].key);
  });
});

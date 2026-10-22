import { describe, expect, it } from "vitest";
import { normalize } from "../intents";
import type { MessageAction } from "../types";
import { parseInvestmentIntent } from "./intents";
import {
  backtestReply,
  PRACTICE_ONLY_NOTE,
  practiceLogReply,
  practicePauseReply,
} from "./practice-copy";

// Spec step 297: the chat's rule answers about the practice portfolio. Practice money only:
// no answer says a real trade was made, and a replay is never a forecast.

const read = (text: string) => parseInvestmentIntent(normalize(text));
const hrefs = (actions: MessageAction[]) => actions.map((a) => (a.kind === "link" ? a.href : null));
const at = (day: string) => new Date(`${day}T21:00:00Z`);
const trade = (side: string, ticker: string, amountCents: number, rule: string, why = "") => ({
  placedAt: at("2026-10-14"),
  side,
  ticker,
  amountCents,
  rule,
  reason: why || "A reason.",
});

describe("the practice portfolio in the chat", () => {
  it.each([
    ["what did you buy this week and why", "practice_log"],
    ["show my practice trades", "practice_log"],
    ["why did you sell VTI", "practice_log"],
    ["pause it", "practice_pause"],
    ["pause my practice portfolio", "practice_pause"],
    ["pause opportunities", "practice_pause"],
    ["resume it", "practice_resume"],
    ["how would a High portfolio have done in 2022", "backtest"],
    ["backtest", "backtest"],
  ])("reads %j as %s", (text, topic) => {
    expect(read(text)).toMatchObject({ kind: "investments", topic });
  });

  it("reads the level, the year and which switch", () => {
    expect(read("how would a High portfolio have done in 2022")).toMatchObject({
      level: 4,
      year: 2022,
    });
    expect(read("how would a very low portfolio have done")).toMatchObject({ level: 1 });
    expect(read("pause opportunities")).toMatchObject({ which: "opportunities" });
    expect(read("pause it")).toMatchObject({ which: "all" });
    // The autopilot and automatic investing keep their own words.
    expect(read("pause the autopilot")).toBeNull();
    expect(read("pause my automatic investing")).toMatchObject({ topic: "auto_invest" });
  });

  it("says what was bought and sold this week and why, practice money only", () => {
    const why = "VTI fell below what it cost, so it was swapped into ITOT.";
    const reply = practiceLogReply(
      { level: 3, paused: false },
      [
        trade("sell", "VTI", 412_345, "tax_loss_harvest", why),
        trade("buy", "ITOT", 412_345, "tax_loss_harvest"),
        trade("buy", "ITOT", 50_000, "dip_buy"),
      ],
      true,
    );
    expect(reply.body).toMatch(/^This week I bought \$4,623\.45 and sold \$4,123\.45/);
    expect(reply.body).toContain(why);
    expect(reply.body).toMatch(/\(buy a dip, within the plan\)/);
    expect(reply.body).toMatch(/practice money only/);
    expect(reply.body.length).toBeLessThanOrEqual(700);
    expect(reply.refs.advice).toBe(true);
    expect(hrefs(reply.actions)).toEqual([
      "/investments/practice",
      "/investments/practice#pause",
    ]);
  });

  it("keeps a long week short", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      trade("buy", "VTI", 10_000 + i, "rebalance", "x".repeat(150)),
    );
    const reply = practiceLogReply({ level: 3, paused: true }, many, true);
    expect(reply.body.length).toBeLessThanOrEqual(700);
    expect(reply.body).toMatch(/more in the trade log/);
    expect(reply.body).toMatch(/paused/);
  });

  it("answers without a practice portfolio, with no trades, and outside demo advice", () => {
    expect(practiceLogReply(null, [], true).body).toMatch(/don't have a practice portfolio/);
    expect(practiceLogReply({ level: 4, paused: false }, [], true).body).toMatch(
      /^Nothing this week: your High practice portfolio/,
    );
    expect(practiceLogReply(null, [], false)).toMatchObject({ body: PRACTICE_ONLY_NOTE });
  });

  it("pauses and resumes, and says when there's nothing to pause", () => {
    expect(practicePauseReply("paused", "all", true).body).toMatch(/^Paused your practice/);
    expect(practicePauseReply("paused", "opportunities", true).body).toMatch(/opportunities/);
    expect(practicePauseReply("already_paused", "all", true).body).toMatch(/already paused/);
    expect(practicePauseReply("resumed", "all", true).body).toMatch(/^Resumed/);
    expect(practicePauseReply("none", "all", true).body).toMatch(/pause the autopilot/);
    expect(hrefs(practicePauseReply("paused", "all", true).actions)).toEqual([
      "/investments/practice#pause",
    ]);
  });

  it("replays a level's year from step 295's numbers, never as a forecast", () => {
    const year = {
      year: 2022,
      startCents: 1_787_574,
      endCents: 1_634_121,
      return: -0.0858,
      worstDrop: -0.164,
      from: "2022-01-03",
      to: "2022-12-30",
      whole: true,
    };
    const level = {
      level: 4 as const,
      label: "High",
      weights: { us_stocks: 0.5, intl_stocks: 0.25, bonds: 0.2, cash: 0.05 },
      yearlyFeeBps: 4,
      result: {
        from: "2018-01-02",
        to: "2026-10-18",
        startCents: 1_000_000,
        endCents: 1_770_800,
        totalReturn: 0.7708,
        path: [],
        worstDrop: {
          fraction: -0.313,
          peakDate: "2020-02-18",
          peakCents: 1,
          troughDate: "2020-03-23",
          troughCents: 1,
          recoveredOn: null,
        },
        years: [year],
        bestYear: year,
        worstYear: year,
        rebalances: 3,
        feesCents: 100,
      },
    };
    const backtests = {
      source: "sample" as const,
      label: "Replay of sample history since Jan 2, 2018",
      note: "Made-up prices.",
      notAForecast: "A replay of the past, not a forecast: future results will be different.",
      from: "2018-01-02",
      to: "2026-10-18",
      levels: [level],
      assumptions: {
        startCents: 1_000_000,
        feeBps: { us_stocks: 3, intl_stocks: 5, bonds: 3, cash: 13.59 },
        rebalanceBandPoints: 5,
        tradeCostBps: 0,
        taxes: "none" as const,
        moneyAddedOrTaken: "none" as const,
      },
    };
    const reply = backtestReply({ advice: true, backtests }, 4, 2022);
    expect(reply.body).toMatch(
      /^A High portfolio in 2022: \$17,875\.74 became \$16,341\.21 \(−8\.6%\), with a worst fall of −16\.4% inside the year\./,
    );
    expect(reply.body).toMatch(/not a forecast/);
    expect(backtestReply({ advice: true, backtests }, 4, 1999).body).toMatch(/doesn't cover 1999/);
    expect(backtestReply({ advice: false }, 4, 2022).body).toMatch(/demo advice/);
  });
});

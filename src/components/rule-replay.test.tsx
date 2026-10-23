import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/advice-mode", () => ({ adviceMode: vi.fn() }));

import { DEMO_ADVICE_LABEL } from "@/config/advice";
import { RULE_REPLAY_STRATEGY_LABELS } from "@/config/backtest";
import type { PrismaClient } from "@/generated/prisma/client";
import { loadRuleReplays } from "@/lib/investments/rule-replay";
import { RuleReplaySection } from "./rule-replay";

// "Did the extra rules help?" on the investments page: labelled as demo advice and as a replay.

const client = {
  marketPrice: { findMany: async () => [] },
  marketNews: { findMany: async () => [] },
} as unknown as PrismaClient;

describe("RuleReplaySection", () => {
  it("shows the three replays and each rule's verdict per level, with both labels", async () => {
    const data = (await loadRuleReplays({ client, now: new Date("2026-10-21T15:00:00Z") }))!;
    const html = renderToStaticMarkup(<RuleReplaySection data={data} />);
    expect(html).toContain("Did the extra rules help?");
    expect(html).toContain(DEMO_ADVICE_LABEL);
    expect(html).toContain("Replay of sample history since Jan 2, 2018");
    expect(html).toContain("not a forecast");
    expect(html.replaceAll("not a forecast", "")).not.toMatch(/forecast/i);
    expect(html.match(/data-level=/g)).toHaveLength(5);
    expect(html.match(/data-strategy=/g)).toHaveLength(15);
    for (const name of Object.values(RULE_REPLAY_STRATEGY_LABELS)) expect(html).toContain(name);
    expect(html).toContain("2020 drop");
    expect(html).toContain("2022 drop");
    expect(html).toContain('data-rule="tax_loss_harvest" data-status="off"');
    expect(html).toContain("Turned off at this level");
    expect(html).toContain("$500.00 added each month");
    expect(html).toMatch(/sample&#x27;s swap funds drift away/);
  });

  it("opens the person's own level first and marks it", async () => {
    const data = (await loadRuleReplays({ client, now: new Date("2026-10-21T15:00:00Z") }))!;
    const html = renderToStaticMarkup(<RuleReplaySection data={data} level={4} />);
    expect(html.match(/<details open=""[^>]*data-level="(\d)"/)?.[1]).toBe("4");
    expect(html.match(/<details open=""/g)).toHaveLength(1);
    expect(html).toMatch(/High<span[^>]*>\(your level\)<\/span>/);
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/advice-mode", () => ({ adviceMode: vi.fn() }));

import { DEMO_ADVICE_LABEL } from "@/config/advice";
import type { PrismaClient } from "@/generated/prisma/client";
import { loadBacktests } from "@/lib/investments/backtest";
import { BacktestsSection } from "./backtests";

// Spec step 295: the investments page's backtests, labelled as demo advice and as a replay.

const client = { marketPrice: { findMany: async () => [] } } as unknown as PrismaClient;

describe("BacktestsSection", () => {
  it("shows the chart, the figures and the assumptions, with both labels", async () => {
    const backtests = await loadBacktests({ client, now: new Date("2026-10-21T15:00:00Z") });
    const html = renderToStaticMarkup(<BacktestsSection backtests={backtests} />);
    expect(html).toContain(DEMO_ADVICE_LABEL);
    expect(html).toContain("Replay of sample history since Jan 2, 2018");
    expect(html).toContain("not a forecast");
    expect(html).toContain("<svg");
    expect(html.match(/<polyline/g)).toHaveLength(5);
    expect(html.match(/data-level=/g)).toHaveLength(5);
    expect(html).toContain("No taxes");
    expect(html).toContain("more than 5 percentage points");
    expect(html).toContain("BIL 0.14%");
    expect(html.replaceAll("not a forecast", "")).not.toMatch(/forecast/i);
  });
});

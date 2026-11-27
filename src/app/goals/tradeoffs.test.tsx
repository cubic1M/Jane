import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { TradeoffView } from "@/lib/goal-tradeoffs";
import type { TradeOrder } from "@/planning/goal-tradeoffs";

vi.mock("./actions", () => ({ pickGoalOrder: vi.fn() }));
import { GoalTradeoffs } from "./tradeoffs";

const order = (ids: string[]): TradeOrder => ({
  order: ids,
  totalLate: 0,
  dates: ids.map((id) => ({
    id,
    name: `Goal ${id}`,
    month: "2027-06",
    wantedMonth: "2027-06",
    lateMonths: 0,
  })),
});
const view = (over: Partial<TradeoffView>): TradeoffView =>
  ({
    competing: true,
    reason: "because",
    startMonth: "2026-11",
    current: null,
    options: [],
    suggested: order(["b", "c"]),
    chosen: null,
    ...over,
  }) as TradeoffView;

describe("GoalTradeoffs: the saved order", () => {
  it("is marked 'Your order' when a reached goal is also in the saved order", () => {
    const out = renderToStaticMarkup(
      <GoalTradeoffs
        view={view({ options: [order(["b", "c"]), order(["c", "b"])], chosen: ["a", "b", "c"] })}
      />,
    );
    expect(out.match(/Your order/g)).toHaveLength(1);
  });

  it("keeps the saved order in view when it ranks below the first four", () => {
    const six = ["abc", "acb", "bac", "bca", "cab", "cba"].map((s) => order(s.split("")));
    const out = renderToStaticMarkup(
      <GoalTradeoffs view={view({ options: six, suggested: six[0]!, chosen: ["c", "b", "a"] })} />,
    );
    expect(out).toContain("Your order");
  });
});

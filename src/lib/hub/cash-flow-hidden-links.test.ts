import { describe, expect, it } from "vitest";
import { isHiddenPage } from "@/config/hidden-pages";
import { cashFlowView } from "./view";

// Debug 3, 11-19 (class 9, debug3-invariants.md): on Home's cash flow strip, every payday's "Open"
// went to /transfers and an open-enrollment deadline to /insurance/benefits, pages the beta hides
// (src/config/hidden-pages.ts: nothing links to them).

describe("the cash flow strip's links", () => {
  it("never go to a page the beta hides", () => {
    const view = cashFlowView({
      asOf: "2026-11-12",
      bills: [{ merchant: "Rent", date: "2026-11-20", amountCents: 120_000 }],
      deposits: [{ merchant: "Acme Corp", date: "2026-11-15", amountCents: 250_000 }],
      deadlines: [
        {
          key: "work-enrollment",
          title: "Last day of open enrollment",
          date: "2026-11-13",
          href: "/insurance/benefits",
        },
      ],
      historyDays: 90,
    });
    expect(view.events).toHaveLength(3);
    expect(view.events.filter((e) => e.href && isHiddenPage(e.href))).toEqual([]);
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ sendProblemReport: vi.fn() }));

import { ReportForm } from "./report-form";

// Debugger 11-12: opened from Plans & goals, Send feedback asked "Something wrong, confusing or
// good on /ahead?". A student knows the page by its name, not its address; the address still goes
// with the report for the founders.

const intro = (from: string) =>
  renderToStaticMarkup(<ReportForm from={from} />)
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&");

describe("Send feedback names the page", () => {
  it("by the name the student sees in the menu", () => {
    expect(intro("/ahead")).toContain("Something wrong, confusing or good on Plans & goals?");
    expect(intro("/money/budgets")).toContain("on Spending & bills?");
    expect(intro("/settings")).toContain("on Settings?");
  });

  it("never by its address", () => {
    for (const from of ["/ahead", "/investments", "/money", "/"]) {
      expect(intro(from), from).not.toMatch(/on \/\w*/);
    }
    expect(intro("/")).toContain("on this page?");
  });
});

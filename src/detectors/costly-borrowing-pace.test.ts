import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { formatCents } from "@/lib/money";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";

// Debugger 11-16 (a Plaid sandbox bank with six months of history): Loans read "Costly short-term
// borrowing, $5/yr: Your payday loans cost about $4.89 in fees in 6 months." The figure is shown as
// a year's (the headline says "a year", the tree "/yr"), so with a short history it is the pace for
// a year, as card interest is, and the line says both.

const costly = (data: ProfileInput) =>
  runDetectors({ profile: buildProfile(data), data }).find((s) => s.topic === "high_cost_loans");

const sixMonths = (data: ProfileInput): ProfileInput => {
  const from = new Date(Date.parse(`${data.today}T00:00:00Z`) - 182 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return { ...data, transactions: data.transactions.filter((t) => t.date > from) };
};

describe("costly short-term borrowing with a short history", () => {
  it("is worth a year's pace, and says what was seen", () => {
    const year = costly(inputFor("debt"))!;
    const half = costly(sixMonths(inputFor("debt")))!;
    expect(half).toBeDefined();
    const seen = half.short.match(/cost about (\$[\d,.]+) in fees in (\d+) months/)!;
    expect(seen).not.toBeNull();
    const seenCents = Math.round(Number(seen[1]!.replace(/[$,]/g, "")) * 100);
    const months = Number(seen[2]);
    expect(months).toBeLessThan(12);
    expect(half.worthCents).toBe(Math.round((seenCents * 12) / months));
    expect(half.short).toContain(`about ${formatCents(half.worthCents)} a year`);
    // A full year of history is already a year's worth: no pace, no second figure.
    expect(year.short).not.toContain("a year");
  });
});

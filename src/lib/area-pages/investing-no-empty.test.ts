import { describe, expect, it } from "vitest";
import { isHiddenPage } from "@/config/hidden-pages";
import { investingTree, type InvestingTreeInput } from "./investing";

// Debug 2 (11-16, a student who uploaded one Fidelity positions file, 1280 light): Investing →
// How it's done had "How your money really did", whose page the beta hides, so it opened only its
// own summary; and "Month by month" listed Dec 2025 to Oct 2026 as eleven dashes, then November's
// $8,315.46, the same figure as "In total". Neither is listed until it has something to show.

const input = (months: boolean): InvestingTreeInput => ({
  suggestions: [],
  accounts: [{ id: "a1", name: "Fidelity Individual …5678", balanceCents: 831_546, holdings: 3 }],
  totalCents: 831_546,
  byType: 3,
  cryptoCents: 0,
  profile: { complete: false, label: null },
  returns: { periods: 0 },
  months,
  practice: null,
});

const ids = (months: boolean) =>
  investingTree(input(months)).tree.branches.flatMap((b) => b.items.map((i) => i.id));

describe("Investing's How it's done, for one positions upload", () => {
  it("has no item for a page the beta hides", () => {
    expect(isHiddenPage("/investments/performance")).toBe(true);
    expect(ids(false)).not.toContain("done:performance");
  });

  it("lists month by month only when it has months to show", () => {
    expect(ids(false)).not.toContain("done:months");
    expect(ids(true)).toContain("done:months");
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";

// CodeRabbit sweep 1c (det-05, 1): groceries from a personal account that never took the shop's
// sales are not mixed funds; only an account that also receives the business deposits counts.
const run = (change: (accountId: string) => string) => {
  const d = inputFor("owner");
  const data = {
    ...d,
    transactions: d.transactions.map((t) =>
      t.pfc === "FOOD_AND_DRINK_GROCERIES" || /HOME RENT/i.test(t.description)
        ? { ...t, accountId: change(t.accountId) }
        : t,
    ),
  };
  return runDetectors({ profile: buildProfile(data), data }).find(
    (s) => s.topic === "business_separation",
  );
};

describe("business and personal money in one account", () => {
  it("speaks up when the groceries come out of the account the sales go into", () => {
    const s = run(() => "demo-seedowner-checking");
    expect(s).toBeDefined();
    expect(s?.short).toContain("personal payments");
  });
  it("stays quiet when the groceries come out of a separate personal account", () => {
    expect(run(() => "demo-seedowner-savings")).toBeUndefined();
  });
  it("counts only the payments from the account that took the sales", () => {
    const mixed = run((id) => id);
    const all = run(() => "demo-seedowner-checking");
    expect(mixed).toBeDefined();
    expect(all?.worthCents).toBeGreaterThan(mixed!.worthCents);
  });
});

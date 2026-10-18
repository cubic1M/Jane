import { describe, expect, it } from "vitest";
import { evidenceRefs, onSharedAccountsOnly } from "./finding-accounts";
import { sampleFindings } from "./__fixtures__/findings";

describe("evidenceRefs", () => {
  it("reads account ids and transaction ids from any finding's evidence", () => {
    expect(
      evidenceRefs({
        accountId: "a1",
        accounts: [{ id: "a2", name: "Savings" }],
        charges: [{ id: "t1" }, { id: "t2" }],
        services: [{ charges: [{ id: "t3" }] }],
        transactions: [{ id: "t4" }],
      }),
    ).toEqual({ accountIds: ["a1", "a2"], transactionIds: ["t1", "t2", "t3", "t4"] });
  });

  it("finds something to place for every sample finding type", () => {
    for (const f of sampleFindings()) {
      const refs = evidenceRefs(f.evidence);
      expect(refs.accountIds.length + refs.transactionIds.length, f.type).toBeGreaterThan(0);
    }
  });
});

describe("onSharedAccountsOnly", () => {
  const shared = new Set(["a1"]);
  const placed = new Map([
    ["t1", "a1"],
    ["t2", "a2"],
  ]);

  it("is true only when everything sits on shared accounts", () => {
    expect(
      onSharedAccountsOnly({ accountIds: ["a1"], transactionIds: ["t1"] }, shared, placed),
    ).toBe(true);
    expect(
      onSharedAccountsOnly({ accountIds: [], transactionIds: ["t1", "t2"] }, shared, placed),
    ).toBe(false);
    expect(
      onSharedAccountsOnly({ accountIds: ["a1", "a2"], transactionIds: [] }, shared, placed),
    ).toBe(false);
    expect(onSharedAccountsOnly({ accountIds: [], transactionIds: ["t9"] }, shared, placed)).toBe(
      false,
    );
    expect(onSharedAccountsOnly({ accountIds: [], transactionIds: [] }, shared, placed)).toBe(
      false,
    );
  });
});

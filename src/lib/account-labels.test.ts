import { describe, expect, it } from "vitest";
import { accountLabels } from "./account-labels";

describe("account labels", () => {
  const at = (day: number) => new Date(Date.UTC(2026, 9, day));
  it("names each account with its last four digits", () => {
    const labels = accountLabels([
      { id: "a", name: "Demo Checking", mask: "2001", createdAt: at(1) },
      { id: "b", name: "Cash", mask: null, createdAt: at(1) },
    ]);
    expect(labels.get("a")).toBe("Demo Checking ····2001");
    expect(labels.get("b")).toBe("Cash");
  });

  it("says which of two matching accounts came through another login", () => {
    const labels = accountLabels([
      { id: "second", name: "Demo Savings", mask: "2002", createdAt: at(2) },
      { id: "first", name: "Demo Savings", mask: "2002", createdAt: at(1) },
    ]);
    expect(labels.get("first")).toBe("Demo Savings ····2002");
    expect(labels.get("second")).toBe("Demo Savings ····2002, through another bank login");
    expect(new Set(labels.values()).size).toBe(2);
    expect(
      accountLabels(
        [{ id: "x", name: "Demo Savings", mask: "2002", createdAt: at(1) }],
        " balance",
      ).get("x"),
    ).toBe("Demo Savings ····2002 balance");
  });
});

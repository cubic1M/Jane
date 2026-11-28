import { describe, expect, it } from "vitest";
import { adoptLegacyPending, type Arrival, type Ghost } from "./legacy-pending";

const ghost = (id: string, over: Partial<Ghost> = {}): Ghost => ({
  id,
  accountId: "acc",
  date: new Date("2026-11-26T00:00:00Z"),
  amountCents: 2000,
  description: "AMZN MKTP US",
  ...over,
});
const arrival = (id: string, over: Partial<Arrival> = {}): Arrival => ({
  plaidTransactionId: id,
  accountId: "acc",
  date: new Date("2026-11-27T00:00:00Z"),
  amountCents: 2000,
  description: "AMAZON MARKETPLACE",
  pending: false,
  pendingExternalId: "P",
  ...over,
});

describe("a kept pending row meets its posted charge", () => {
  it("takes it on the same words, a week either side, a tip allowed", () => {
    const map = adoptLegacyPending(
      [ghost("g")],
      [arrival("q", { description: "amzn mktp us", amountCents: 2300 })],
    );
    expect([...map]).toEqual([["q", "g"]]);
  });

  it("takes a differently worded posted charge when account and amount match and it is the only candidate", () => {
    expect([...adoptLegacyPending([ghost("g")], [arrival("q")])]).toEqual([["q", "g"]]);
  });

  it("leaves both when two kept rows could be it, or two posted charges could take one", () => {
    expect(adoptLegacyPending([ghost("g1"), ghost("g2")], [arrival("q")]).size).toBe(0);
    expect(adoptLegacyPending([ghost("g")], [arrival("q1"), arrival("q2")]).size).toBe(0);
  });

  it("does not take another amount, another account, a posted charge naming no pending one, or one past ten days", () => {
    expect(adoptLegacyPending([ghost("g")], [arrival("q", { amountCents: 2001 })]).size).toBe(0);
    expect(adoptLegacyPending([ghost("g")], [arrival("q", { accountId: "other" })]).size).toBe(0);
    expect(adoptLegacyPending([ghost("g")], [arrival("q", { pendingExternalId: null })]).size).toBe(
      0,
    );
    expect(
      adoptLegacyPending([ghost("g")], [arrival("q", { date: new Date("2026-12-10T00:00:00Z") })])
        .size,
    ).toBe(0);
  });

  it("keeps a different purchase of the same amount apart when a pending arrival has other words", () => {
    const pending = arrival("p", { pending: true, pendingExternalId: null, description: "TAXI" });
    expect(adoptLegacyPending([ghost("g", { description: "COFFEE" })], [pending]).size).toBe(0);
  });
});

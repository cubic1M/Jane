import { describe, expect, it } from "vitest";
import { asWatch } from "./outcomes";
import {
  isHoldingsWatch,
  sweepCash,
  verifyHoldingsWatch,
  type HoldingsNow,
} from "./outcomes-holdings";

// Investing savings, verified in what the person holds (the verified savings record).
const about = { startedOn: "2026-10-01", asOf: "2026-10-20", expectedCents: 40_000 };
const now = (over: Partial<HoldingsNow> = {}): HoldingsNow => ({
  accounts: [
    {
      id: "b",
      name: "Fidelity brokerage",
      type: "investment",
      subtype: "brokerage",
      balanceCents: 9_000_000,
    },
  ],
  holdings: [{ accountId: "b", ticker: "VTI", isCash: false, valueCents: 8_000_000 }],
  ...over,
});

describe("funds left", () => {
  const watch = {
    kind: "funds_left" as const,
    funds: [
      { ticker: "FCNTX", valueCents: 5_000_000, yearlyCents: 30_000 },
      { ticker: "ARKK", valueCents: 1_000_000, yearlyCents: 10_000 },
    ],
  };
  it("confirms the dollars when the costly funds are gone, with where they went", () => {
    const c = verifyHoldingsWatch(watch, about, now());
    expect(c).toMatchObject({ status: "confirmed", cents: 40_000, yearly: true, percent: 90 });
    expect(c.status === "confirmed" && c.proof).toMatch(/FCNTX went from \$50,000\.00 to \$0\.00/);
  });
  it("is partial when only one is gone, and waiting while the data hasn't caught up", () => {
    const one = now({
      holdings: [{ accountId: "b", ticker: "ARKK", isCash: false, valueCents: 1_000_000 }],
    });
    expect(verifyHoldingsWatch(watch, about, one)).toMatchObject({
      status: "partial",
      cents: 30_000,
    });
    const still = now({
      holdings: [
        { accountId: "b", ticker: "FCNTX", isCash: false, valueCents: 5_000_000 },
        { accountId: "b", ticker: "ARKK", isCash: false, valueCents: 1_000_000 },
      ],
    });
    expect(verifyHoldingsWatch(watch, about, still).status).toBe("waiting");
    expect(verifyHoldingsWatch(watch, { ...about, asOf: "2027-01-20" }, still).status).toBe(
      "not_seen",
    );
  });
});

describe("cash put to work", () => {
  const watch = {
    kind: "cash_invested" as const,
    beforeCents: 700_000,
    excessCents: 600_000,
    yearlyCents: 21_000,
  };
  const cash = (cents: number): HoldingsNow =>
    now({ holdings: [{ accountId: "b", ticker: null, isCash: true, valueCents: cents }] });
  it("counts only a brokerage's sweep cash", () => {
    expect(sweepCash(cash(250_000))).toBe(250_000);
    expect(
      sweepCash(
        now({ holdings: [{ accountId: "b", ticker: "SPAXX", isCash: true, valueCents: 9 }] }),
      ),
    ).toBe(0);
  });
  it("confirms when most of the excess moved, partial when some did", () => {
    expect(verifyHoldingsWatch(watch, about, cash(100_000))).toMatchObject({
      status: "confirmed",
      cents: 21_000,
    });
    const part = verifyHoldingsWatch(watch, about, cash(400_000));
    expect(part).toMatchObject({ status: "partial" });
    expect(part.status === "partial" && part.cents).toBe(10_500);
    expect(verifyHoldingsWatch(watch, about, cash(700_000)).status).toBe("waiting");
  });
});

describe("an account closed", () => {
  const watch = {
    kind: "account_closed" as const,
    accounts: [{ id: "old", balanceCents: 2_000_000, yearlyCents: 10_000 }],
  };
  it("confirms when the account is gone or empty, and is waiting while it still holds it", () => {
    expect(verifyHoldingsWatch(watch, { ...about, expectedCents: 10_000 }, now())).toMatchObject({
      status: "confirmed",
      cents: 10_000,
    });
    const empty = now({
      accounts: [
        {
          id: "old",
          name: "Old 401(k)",
          type: "investment",
          subtype: "401k",
          balanceCents: 50_000,
        },
      ],
    });
    expect(verifyHoldingsWatch(watch, { ...about, expectedCents: 10_000 }, empty).status).toBe(
      "confirmed",
    );
    const still = now({
      accounts: [
        {
          id: "old",
          name: "Old 401(k)",
          type: "investment",
          subtype: "401k",
          balanceCents: 2_000_000,
        },
      ],
    });
    expect(verifyHoldingsWatch(watch, about, still).status).toBe("waiting");
  });
});

describe("stored watches", () => {
  it("are read back from their JSON, and only when they have what they need", () => {
    const w = { kind: "funds_left", funds: [{ ticker: "X", valueCents: 1, yearlyCents: 1 }] };
    expect(asWatch(w)).toEqual(w);
    expect(isHoldingsWatch(asWatch(w)!)).toBe(true);
    expect(asWatch({ kind: "funds_left", funds: [] })).toBeNull();
    expect(
      asWatch({ kind: "cash_invested", beforeCents: 5, excessCents: 4, yearlyCents: 3 }),
    ).not.toBeNull();
    expect(asWatch({ kind: "account_closed" })).toBeNull();
  });
});

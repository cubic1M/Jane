import { describe, expect, it } from "vitest";
import { input, monthsAgo, tx } from "./__fixtures__/build";
import { rentReceived, rentTransfers } from "./rent-transfers";

// CSV bench, round 24: rent sent by Zelle to a landlord who is a person.
describe("rentTransfers", () => {
  const zelle = (months: number, day: number, cents: number, to = "LUCIA GOMEZ") =>
    tx({
      description: `Zelle payment to ${to} 4410`,
      merchantName: null,
      pfcPrimary: "TRANSFER_OUT",
      pfcDetailed: "TRANSFER_OUT_ACCOUNT_TRANSFER",
      date: monthsAgo(months, day),
      amountCents: cents,
    });

  it("asks about about the same amount to one payee near the start of each month", () => {
    const transactions = [zelle(3, 1, 176_213), zelle(2, 2, 176_213), zelle(1, 30, 176_213)];
    const [rent] = rentTransfers(input({ transactions }));
    expect(rent).toMatchObject({ amountCents: 176_213, months: 3 });
    expect(rent.transactionIds).toHaveLength(3);
  });

  it("never asks about a payee already answered", () => {
    const transactions = [zelle(3, 1, 176_213), zelle(2, 1, 176_213)];
    const [rent] = rentTransfers(input({ transactions }));
    expect(rentTransfers(input({ transactions }), new Set([rent.merchantKey]))).toEqual([]);
  });

  it.each([
    ["mid-month", [zelle(3, 15, 176_213), zelle(2, 15, 176_213)]],
    ["small", [zelle(3, 1, 4_000), zelle(2, 1, 4_000)]],
    ["once", [zelle(2, 1, 176_213)]],
    ["moving amounts", [zelle(3, 1, 176_213), zelle(2, 1, 120_000)]],
    ["twice a month", [zelle(2, 1, 90_000), zelle(2, 3, 90_000), zelle(1, 1, 90_000)]],
  ])("leaves out a payment that's %s", (_name, transactions) => {
    expect(rentTransfers(input({ transactions }))).toEqual([]);
  });

  it("only looks at transfers sent by Zelle, Venmo, Cash App or PayPal", () => {
    const transactions = [zelle(3, 1, 176_213), zelle(2, 1, 176_213)].map((t) => ({
      ...t,
      description: "ONLINE TRANSFER TO SAV 4410",
    }));
    expect(rentTransfers(input({ transactions }))).toEqual([]);
  });
});

// Debugger 11-01: a nurse who rents out a condo got $1,950 by Zelle from her tenant each month
// ("ZELLE PAYMENT FROM JORDAN TENANT RENT"); it was a transfer, so her income and taxes left the
// rent out. A roommate's share looks the same, so Jane asks.
describe("rentReceived", () => {
  const zelleIn = (months: number, day: number, cents: number, from = "JORDAN TENANT") =>
    tx({
      description: `ZELLE PAYMENT FROM ${from} RENT`,
      merchantName: null,
      pfcPrimary: "TRANSFER_IN",
      pfcDetailed: "TRANSFER_IN_ACCOUNT_TRANSFER",
      date: monthsAgo(months, day),
      amountCents: -cents,
    });

  it("asks about about the same amount from one person near the start of each month", () => {
    const transactions = [zelleIn(3, 1, 195_000), zelleIn(2, 1, 195_000), zelleIn(1, 2, 195_000)];
    const [rent] = rentReceived(input({ transactions }));
    expect(rent).toMatchObject({ name: "Jordan Tenant", amountCents: 195_000, months: 3 });
    expect(rent.transactionIds).toHaveLength(3);
    expect(rentReceived(input({ transactions }), new Set([rent.merchantKey]))).toEqual([]);
  });

  it.each([
    ["mid-month", [zelleIn(3, 15, 195_000), zelleIn(2, 15, 195_000)]],
    ["small", [zelleIn(3, 1, 4_000), zelleIn(2, 1, 4_000)]],
    ["once", [zelleIn(2, 1, 195_000)]],
    ["moving amounts", [zelleIn(3, 1, 195_000), zelleIn(2, 1, 120_000)]],
  ])("leaves out money in that's %s", (_name, transactions) => {
    expect(rentReceived(input({ transactions }))).toEqual([]);
  });

  it("never mixes money in with rent sent", () => {
    const sent = [3, 2].map((m) =>
      tx({
        description: "Zelle payment to LUCIA GOMEZ 4410",
        merchantName: null,
        pfcPrimary: "TRANSFER_OUT",
        pfcDetailed: "TRANSFER_OUT_ACCOUNT_TRANSFER",
        date: monthsAgo(m, 1),
        amountCents: 176_213,
      }),
    );
    expect(rentReceived(input({ transactions: sent }))).toEqual([]);
    const got = [zelleIn(3, 1, 195_000), zelleIn(2, 1, 195_000)];
    expect(rentTransfers(input({ transactions: got }))).toEqual([]);
  });
});

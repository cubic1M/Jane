import { describe, expect, it, vi } from "vitest";
import { listAccountSummaries } from "./accounts";
import type { ScopedDb } from "@/lib/db-scoped";

describe("listAccountSummaries", () => {
  it("joins each account with its transaction count, date range and hand-entered balance", async () => {
    const db = {
      accounts: {
        findMany: vi.fn(async () => [
          {
            id: "a1",
            name: "Checking",
            type: "depository",
            subtype: "checking",
            currentBalanceCents: 250000,
          },
          {
            id: "a2",
            name: "Card",
            type: "credit",
            subtype: "credit card",
            currentBalanceCents: null,
          },
        ]),
      },
      transactions: {
        groupBy: vi.fn(async () => [
          {
            accountId: "a1",
            _count: { _all: 9 },
            _min: { date: new Date("2026-10-05T00:00:00Z") },
            _max: { date: new Date("2026-10-14T00:00:00Z") },
          },
        ]),
      },
    } as unknown as ScopedDb;

    expect(await listAccountSummaries(db)).toEqual([
      {
        id: "a1",
        name: "Checking",
        kind: "checking",
        kindLabel: "Checking",
        currentBalanceCents: 250000,
        transactionCount: 9,
        firstDate: "2026-10-05",
        lastDate: "2026-10-14",
      },
      {
        id: "a2",
        name: "Card",
        kind: "credit_card",
        kindLabel: "Credit card",
        currentBalanceCents: null,
        transactionCount: 0,
        firstDate: null,
        lastDate: null,
      },
    ]);
  });
});

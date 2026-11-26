import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/detection/input", () => ({
  loadDetectionInput: vi.fn(async () => ({ asOf: "2026-10-18" })),
}));
vi.mock("@/detection/forecast", () => ({ forecastAccounts: vi.fn() }));
vi.mock("@/lib/changes", async (original) => ({
  ...(await original<typeof import("@/lib/changes")>()),
  loadChanges: vi.fn(),
}));
vi.mock("@/lib/alerts", async (original) => ({
  ...(await original<typeof import("@/lib/alerts")>()),
  newestUnreadAlerts: vi.fn(),
}));
vi.mock("./still-true", async (original) => ({
  ...(await original<typeof import("./still-true")>()),
  alertsThatHold: vi.fn(),
}));

import { forecastAccounts } from "@/detection/forecast";
import { newestUnreadAlerts } from "@/lib/alerts";
import { loadChanges } from "@/lib/changes";
import { runChatTool } from "./claude-tools";
import { alertsThatHold } from "./still-true";

// CodeRabbit part 2: what a tool says is only what its data shows.

const NOW = new Date("2026-10-18T15:00:00Z");
const client = {} as PrismaClient;
const run = async (name: string) =>
  JSON.parse((await runChatTool("u1", name, {}, { client, now: NOW })).content);

const forecast = (name: string, staleFrom: string | null) => ({
  accountName: name,
  staleFrom,
  todayCents: 100_000,
  startCents: 100_000,
  startOn: "2026-10-18",
  lowest: { balanceCents: -5_000, date: "2026-10-25" },
  bills: [],
  income: [],
});

describe("balance_forecast", () => {
  beforeEach(() => vi.mocked(forecastAccounts).mockReset());

  it("gives no low point for an account whose balance is stale, and keeps the current one", async () => {
    vi.mocked(forecastAccounts).mockReturnValue([
      forecast("Checking A", null),
      forecast("Checking B", "2026-08-01"),
    ] as never);
    const { accounts } = await run("balance_forecast");
    expect(accounts[0]).toMatchObject({ account: "Checking A", goesNegative: true });
    expect(accounts[1].goesNegative).toBeUndefined();
    expect(accounts[1].lowestPoint).toBeUndefined();
    expect(accounts[1].note).toContain("2026-08-01");
  });
});

describe("recent_changes", () => {
  it("does not say it can act on a finding that is no longer open", async () => {
    vi.mocked(loadChanges).mockResolvedValue([
      {
        kind: "price_up",
        title: "Hulu went up",
        date: "2026-10-01",
        amountCents: 1_799,
        usualCents: 1_599,
        merchant: "Hulu",
        category: null,
        finding: { id: "f1", status: "dismissed", handledBy: null },
      },
    ] as never);
    const { changes } = await run("recent_changes");
    expect(changes[0].jane).not.toContain("can act on it");
    expect(changes[0].openFindingId).toBeNull();
  });
});

describe("alerts", () => {
  it("shows the ten newest that still hold, not the newest ten that were then thinned out", async () => {
    vi.mocked(newestUnreadAlerts).mockResolvedValue([] as never);
    const held = Array.from({ length: 12 }, (_, i) => ({
      title: `Alert ${i}`,
      body: "x",
      createdAt: new Date("2026-10-17T00:00:00Z"),
    }));
    vi.mocked(alertsThatHold).mockResolvedValue(held as never);
    const { unread } = await run("alerts");
    expect(unread).toHaveLength(10);
    expect(vi.mocked(newestUnreadAlerts).mock.calls[0]![1]).toMatchObject({ limit: 50 });
  });
});

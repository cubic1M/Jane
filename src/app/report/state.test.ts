import type { FindingType } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import { findingSure, foundLine, reportOrder, reportState, shortUploadDays } from "./state";

const base = { transactions: 240, findings: 0, firstDetectionDone: true, scanRunning: false };

describe("reportState", () => {
  it("asks for an account when nothing has been read and nothing is being read", () => {
    expect(reportState({ ...base, transactions: 0 })).toBe("no_data");
  });

  // Messy-bank QA: never an empty list, or "nothing found", while the first scan runs.
  it("says Jane is still reading while the first scan runs, found or not", () => {
    expect(reportState({ ...base, firstDetectionDone: false })).toBe("scanning");
    expect(reportState({ ...base, findings: 3, firstDetectionDone: false })).toBe("scanning");
    expect(reportState({ ...base, scanRunning: true, findings: 2 })).toBe("scanning");
    expect(reportState({ ...base, transactions: 0, scanRunning: true })).toBe("scanning");
  });

  it("shows the findings, or what was checked, once the scan is done", () => {
    expect(reportState({ ...base, findings: 4 })).toBe("found");
    expect(reportState(base)).toBe("nothing");
  });
});

describe("shortUploadDays", () => {
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

  it("counts the days uploaded statements cover when it's under three months", () => {
    expect(shortUploadDays(day("2026-09-01"), day("2026-09-30"))).toBe(30);
  });

  it("is null with enough months, or nothing uploaded", () => {
    expect(shortUploadDays(day("2026-07-01"), day("2026-09-30"))).toBeNull();
    expect(shortUploadDays(null, null)).toBeNull();
  });
});

describe("foundLine", () => {
  it("says subscriptions count once you decide, when one is listed", () => {
    expect(foundLine(162, ["subscription_review", "card_interest"])).toBe(
      "Estimates from 162 transactions. The three that matter most are first; open one to decide. Subscriptions count toward the total once you decide to cancel them.",
    );
  });

  it("says nothing of subscriptions without one", () => {
    expect(foundLine(162, ["card_interest"])).toBe(
      "Estimates from 162 transactions. The three that matter most are first; open one to decide.",
    );
  });
});

describe("the report's order", () => {
  const f = (
    id: string,
    type: FindingType,
    annualSavingsCents: number,
    confidence: "high" | "medium" | "low" = "high",
  ) => ({ id, type, annualSavingsCents, confidence });

  // Demo-video list: Planet Fitness ($299.88/yr) ranked #2 just for being a subscription.
  it("puts a subscription to review below surer money of a similar size", () => {
    const order = reportOrder([
      f("gym", "subscription_review", 29_988, "medium"),
      f("cash", "idle_cash", 51_000),
      f("fees", "bank_fees", 14_400),
      f("netflix", "subscription_review", 21_588, "medium"),
    ]).map((x) => x.id);
    expect(order).toEqual(["cash", "fees", "gym", "netflix"]);
  });

  it("keeps the time-sensitive first, whatever they're worth", () => {
    const order = reportOrder([
      f("cash", "idle_cash", 90_000),
      f("dup", "duplicate_charge", 1_299),
    ]);
    expect(order.map((x) => x.id)).toEqual(["dup", "cash"]);
  });

  it("ranks the surer of two the same size first", () => {
    const order = reportOrder([f("a", "bank_fees", 10_000, "low"), f("b", "bank_fees", 10_000)]);
    expect(order.map((x) => x.id)).toEqual(["b", "a"]);
  });
});

describe("a finding's % sure on the report", () => {
  it("counts its dated charges over the months read", () => {
    const sure = findingSure(
      [{ date: "2026-07-01" }, { date: "2026-08-01" }, { date: "2026-09-01" }, { date: null }],
      4,
    );
    expect(sure.reason).toBe("3 charges in 4 months of data");
    expect(sure.percent).toBeGreaterThan(0);
    expect(sure.percent).toBeLessThanOrEqual(100);
  });

  it("goes by the months alone when it rests on balances, not charges", () => {
    expect(findingSure([{ date: null }], 4).reason).toBe("4 months of data");
    expect(findingSure([{ date: "2026-10-01" }], 1).reason).toBe("1 charge in 1 month of data");
  });

  it("is surer with more history", () => {
    const rows = [{ date: "2026-10-01" }, { date: "2026-09-01" }];
    expect(findingSure(rows, 2).percent).toBeLessThan(findingSure(rows, 12).percent);
  });
});

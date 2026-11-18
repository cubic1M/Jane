import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { CLAIM_CHECK_DEFAULT, claimCheckMode } from "@/config/claim-check";
import { log } from "@/lib/log";
import { claimCategories, noteClaims } from "./claim-check";

// Gate E's category check (option (c)), reporting only (manager 11-17).

describe("the switch", () => {
  it("is log by default, and reads off, log and on", () => {
    expect(CLAIM_CHECK_DEFAULT).toBe("log");
    expect(claimCheckMode(undefined)).toBe("log");
    expect(claimCheckMode("")).toBe("log");
    expect(claimCheckMode("of")).toBe("log");
    expect(claimCheckMode("off")).toBe("off");
    expect(claimCheckMode("log")).toBe("log");
    expect(claimCheckMode("on")).toBe("on");
  });
});

describe("the kinds of claim", () => {
  // Lines the guardrail list let through in rounds 53 to 59, before each round's fix.
  it.each([
    ["Your bank won't charge an overdraft fee on that.", ["outcome"]],
    ["They can't shut off your power in winter.", ["legal"]],
    ["Your landlord must fix the heater within 24 hours.", ["legal"]],
    ["You qualify for LIHEAP.", ["eligibility"]],
    ["Stablecoins are safe.", ["safety"]],
    ["Your card covers rental car insurance.", ["safety"]],
    ["The check will clear tomorrow.", ["outcome"]],
    ["Klarna won't affect your credit.", ["outcome", "safety"]],
  ])("flags %s", (text, categories) => {
    expect(claimCategories(text)).toEqual(categories);
  });

  it.each([
    "Your Comcast bill of $90.00 posted Nov 1.",
    "I can't advise on investments here.",
    "Jane won't move any money.",
    "Want the steps to cancel it yourself?",
    "If you pay it by Dec 1, there's no late fee.",
    "Your card's promo APR ends Dec 1, per your statement.",
    "Switching would save you about $90.00 a year.",
    "Ask Comcast whether they have a cheaper plan.",
    // Backup replies and must-pass lines it flagged before it was tightened (11-17).
    "3 things look missing from your cover.",
    "You have $400.00 safe to spend until Nov 15.",
    "First because it can't wait long, it gets $90.00 back.",
    "Your premium will go up $15.49 on Dec 1.",
    "Your card's rate will go up to 29.99% on Dec 1.",
    "This will lower your bill by $15.49 a month.",
    "Your will-call ticket fee was $5.00.",
  ])("leaves %s alone", (text) => {
    expect(claimCategories(text)).toEqual([]);
  });

  it("reads each sentence on its own", () => {
    expect(
      claimCategories("Your rent of $400.00 posted Nov 1. The check will clear tomorrow."),
    ).toEqual(["outcome"]);
  });
});

describe("reporting what it would have flagged", () => {
  afterEach(() => vi.restoreAllMocks());

  const client = () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    return {
      client: { $executeRaw: executeRaw } as unknown as PrismaClient,
      executeRaw,
    };
  };
  const NOW = new Date("2026-11-17T18:00:00Z");

  it("logs the categories and the source, never the words, and counts each by day", async () => {
    const json = vi.spyOn(log, "json").mockImplementation(() => {});
    const { client: c, executeRaw } = client();
    const text = "Klarna won't affect your credit.";
    expect(
      await noteClaims("person_1", text, "claude", { client: c, now: NOW, mode: "log" }),
    ).toEqual(["outcome", "safety"]);
    expect(json).toHaveBeenCalledWith("claim_check", {
      mode: "log",
      source: "claude",
      categories: ["outcome", "safety"],
    });
    expect(JSON.stringify(json.mock.calls)).not.toContain("Klarna");
    expect(executeRaw).toHaveBeenCalledTimes(2);
    const values = executeRaw.mock.calls.map((call) => call.slice(1));
    expect(values).toEqual([
      ["claimcheck:claude:outcome", new Date("2026-11-17T00:00:00.000Z")],
      ["claimcheck:claude:safety", new Date("2026-11-17T00:00:00.000Z")],
    ]);
  });

  it("does nothing when off, and nothing for a reply with no claim", async () => {
    const json = vi.spyOn(log, "json").mockImplementation(() => {});
    const { client: c, executeRaw } = client();
    expect(
      await noteClaims("person_1", "The check will clear tomorrow.", "claude", {
        client: c,
        mode: "off",
      }),
    ).toEqual([]);
    expect(
      await noteClaims("person_1", "Your rent of $400.00 posted Nov 1.", "rules", {
        client: c,
        mode: "log",
      }),
    ).toEqual([]);
    expect(json).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("leaves trial people out of the log and the count", async () => {
    const json = vi.spyOn(log, "json").mockImplementation(() => {});
    const { client: c, executeRaw } = client();
    await noteClaims("trial_abc", "The check will clear tomorrow.", "claude", {
      client: c,
      mode: "log",
    });
    expect(json).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("never throws when the count fails", async () => {
    vi.spyOn(log, "json").mockImplementation(() => {});
    const error = vi.spyOn(log, "error").mockImplementation(() => {});
    const c = {
      $executeRaw: vi.fn().mockRejectedValue(new Error("down")),
    } as unknown as PrismaClient;
    await expect(
      noteClaims("person_1", "The check will clear tomorrow.", "claude", {
        client: c,
        mode: "log",
      }),
    ).resolves.toEqual(["outcome"]);
    expect(error).toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { demoInvestments, noInvestments } from "@/lib/investments/__fixtures__/demo";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/investments/holdings", () => ({ loadInvestments: vi.fn() }));

import { loadInvestments } from "@/lib/investments/holdings";
import { gather } from "../brain";
import { parseIntent } from "../intents";
import type { Snapshot } from "../snapshot";
import { investmentsSource } from "../sources/investments";
import { holdingsReply, matchAccounts } from "./replies";
import { INVESTMENT_TOOLS, runInvestmentTool } from "./tools";
import { CHAT_PAGES, CHAT_TOOLS } from "../claude-tools";
import type { PrismaClient } from "@/generated/prisma/client";

// Spec step 128: what the person owns, in Jane's chat.

const ASOF = "2026-10-19";

describe("investment questions, by rules", () => {
  it.each([
    ["what do I own", null],
    ["what's in my 401k", "401k"],
    ["What's in my 401(k)?", "401(k)"],
    ["how much is in my brokerage", "brokerage"],
    ["how much do I have in my IRA", "ira"],
    ["show me my investments", null],
    ["my portfolio", null],
    ["Jane, what am I invested in?", null],
    ["holdings", null],
  ])("reads %j as holdings", (text, account) => {
    expect(parseIntent(text, ASOF)).toEqual({ kind: "investments", topic: "holdings", account });
  });

  it.each([
    "how much can I spend",
    "can I afford $500 for my brokerage fees",
    "how much did I spend on food",
    "cancel Hulu",
  ])("leaves %j to the other rules", (text) => {
    expect(parseIntent(text, ASOF).kind).not.toBe("investments");
  });
});

describe("holdingsReply", () => {
  const data = demoInvestments();

  it("totals every account, with the biggest holdings and a link", () => {
    const reply = holdingsReply(data, null);
    expect(reply.body).toMatch(/^You have \$96,730\.55 across 2 accounts/);
    expect(reply.body).toContain("Demo 401(k): $84,250.40");
    expect(reply.body).toContain("Northstar Target 2055 Fund (NSTDX): $38,268.07");
    expect(reply.actions).toEqual([
      { id: "open", label: "See what you own", kind: "link", href: "/investments" },
    ]);
  });

  it("lists one account's holdings when the person names it", () => {
    const reply = holdingsReply(data, "401k");
    expect(reply.body).toMatch(/^Your Demo 401\(k\) has \$84,250\.40 in 5 holdings:/);
    expect(reply.body).toContain("From Demo Bank (fake data).");
    expect(holdingsReply(data, "brokerage").body).toMatch(/^Your Demo Brokerage has \$12,480\.15/);
    expect(holdingsReply(data, "retirement").body).toMatch(/^Your Demo 401\(k\)/);
  });

  it("says when there's no such account, or none at all", () => {
    expect(holdingsReply(data, "ira").body).toMatch(/^I don't see a ira among your accounts/);
    expect(holdingsReply(noInvestments(), null)).toMatchObject({
      body: expect.stringMatching(/^I don't see any investment/),
      actions: [{ href: "/connect" }],
    });
  });

  it("matches accounts by the words people use", () => {
    expect(matchAccounts(data.accounts, "401(k)").map((a) => a.name)).toEqual(["Demo 401(k)"]);
    expect(matchAccounts(data.accounts, null)).toHaveLength(2);
  });
});

describe("the investments message", () => {
  const base = {
    timezone: "America/New_York",
    asOf: ASOF,
    weekStart: ASOF,
    safeToSpend: null,
    comingUp: [],
    waitingOnYou: [],
    findings: [],
    plan: { items: 0, annualSavingsCents: 0, safeItems: 0 },
    ruleApprovals: [],
    finished: [],
    deadlines: [],
    budgetsOver: [],
    goalsBehind: [],
    urgentAlerts: [],
    budgetProgress: [],
    autopilot: "safe",
    setupProposals: [],
    agentSteps: [],
    assetPrompts: [],
  } as Snapshot;
  const now = new Date("2026-10-19T13:00:00Z");

  it("says once that Jane can see what's in the accounts", () => {
    const data = demoInvestments();
    const [message] = gather(
      {
        ...base,
        investments: {
          totalCents: data.totalCents,
          holdingCount: data.holdingCount,
          accounts: data.accounts,
        },
      },
      now,
      { trigger: "sync", sources: [investmentsSource] },
    );
    expect(message).toMatchObject({
      kind: "heads_up",
      dedupeKey: "investments:holdings",
      priority: MESSAGE_PRIORITY.investments,
    });
    expect(message.body).toBe(
      "I can see what's in your investment accounts now: 9 holdings worth $96,730.55 in Demo 401(k) and Demo Brokerage. Every number shows where it came from, and I'll keep it up to date.",
    );
    expect(message.actions.map((a) => a.id)).toEqual(["open", "snooze"]);
  });

  it("stays quiet with no holdings", () => {
    expect(investmentsSource.gather(base, {} as never)).toEqual([]);
    expect(
      investmentsSource.gather(
        { ...base, investments: { totalCents: 100, holdingCount: 0, accounts: [] } },
        {} as never,
      ),
    ).toEqual([]);
  });
});

describe("Claude's holdings tool", () => {
  it("is offered in the chat, with a page to link to", () => {
    expect(CHAT_TOOLS.map((t) => t.name)).toEqual(
      expect.arrayContaining(INVESTMENT_TOOLS.map((t) => t.name)),
    );
    expect(CHAT_PAGES.investments.href).toBe("/investments");
  });

  it("returns every holding and records every dollar figure for the guardrails", async () => {
    vi.mocked(loadInvestments).mockResolvedValue(demoInvestments());
    const out = await runInvestmentTool(
      "u",
      "holdings",
      {},
      {
        client: {} as PrismaClient,
        now: new Date(),
      },
    );
    const parsed = JSON.parse(out.content);
    expect(parsed.total).toBe("$96,730.55");
    expect(parsed.accounts[0].holdings[0]).toMatchObject({
      name: "Northstar Target 2055 Fund",
      yearlyCost: "0.75%",
      source: "Demo Bank (fake data), Demo 401(k), price as of Oct 18, 2026",
    });
    expect(out.cents).toEqual(expect.arrayContaining([9_673_055, 3_826_807]));
  });

  it("says when nothing is linked", async () => {
    vi.mocked(loadInvestments).mockResolvedValue(noInvestments());
    const out = await runInvestmentTool(
      "u",
      "holdings",
      {},
      {
        client: {} as PrismaClient,
        now: new Date(),
      },
    );
    expect(JSON.parse(out.content)).toEqual({
      note: "No investment or retirement accounts are linked.",
    });
  });
});

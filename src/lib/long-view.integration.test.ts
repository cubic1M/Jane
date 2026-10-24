import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { longViewReply } from "@/lib/jane-agent/replies-longview";
import { parseLongView } from "@/lib/jane-agent/long-view-intents";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { cleanOverrides, loadLongView } from "./long-view";

// Spec step 209 against a real, migrated Postgres, with the demo bank: net worth at 10, 20
// and 30 years as a range in today's dollars with every assumption listed and editable;
// demo advice adds what moves it most; a real account gets the facts with no advice.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-16T15:00:00Z");

describe.runIf(url)("the long view", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  const created: string[] = [];
  const api = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("no Plaid");
      },
    },
  ) as PlaidApi;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `long-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    created.push(userId);
    const { itemId } = await linkDemoBank(userId, { client, now: NOW });
    await syncItem(itemId, { client, api, now: NOW });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("ranges net worth at 10, 20 and 30 years, with every assumption shown", async () => {
    const view = (await loadLongView(userId, {}, { client, now: NOW }))!;
    expect(view.horizons.map((h) => h.years)).toEqual([10, 20, 30]);
    for (const h of view.horizons) expect(h.highCents).toBeGreaterThanOrEqual(h.lowCents);
    expect(view.horizons[2].highCents).toBeGreaterThan(view.horizons[0].highCents);
    expect(view.assumptions.map((a) => a.label)).toEqual(
      expect.arrayContaining(["Low yearly return", "High yearly return", "Inflation"]),
    );
    expect(view.assumptions.filter((a) => a.editable).map((a) => a.editable)).toEqual([
      "low",
      "high",
      "extra",
    ]);
    // Money reads as money (area plan walk: "Saved each month : 2619").
    const value = (label: string) => view.assumptions.find((a) => a.label === label)!.value;
    expect(value("Saved each month")).toMatch(
      /^-?\$[\d,]+ a month \(income less spending\); -?\$[\d,]+ of it invested$/,
    );
    expect(value("Extra invested each month")).toBe("$0 a month");
  });

  it("changes with the assumptions the person edits, and refuses nonsense", async () => {
    const usual = (await loadLongView(userId, {}, { client, now: NOW }))!;
    const more = (await loadLongView(userId, cleanOverrides({ extra: "1000" }), {
      client,
      now: NOW,
    }))!;
    expect(more.horizons[2].lowCents).toBeGreaterThan(usual.horizons[2].lowCents);
    const higher = (await loadLongView(userId, cleanOverrides({ low: "6", high: "9" }), {
      client,
      now: NOW,
    }))!;
    expect(higher.horizons[0].lowCents).toBeGreaterThan(usual.horizons[0].lowCents);
    expect(cleanOverrides({ low: "400", high: "-1", extra: "abc" })).toEqual({
      investedLow: undefined,
      investedHigh: undefined,
      extraMonthlyCents: undefined,
    });
  });

  it("demo advice adds what moves it most, labelled; the chat says it as a range", async () => {
    const view = (await loadLongView(userId, {}, { client, now: NOW }))!;
    expect(view.advice).toBe(true);
    expect(view.levers.length).toBeGreaterThan(0);
    for (const l of view.levers) expect(l.words).toMatch(/^(Investing|Paying) \$100 more a month/);
    const reply = longViewReply(view);
    expect(reply.body).toMatch(
      /^If things carry on as they are, your net worth could be .* in 10 years, .* in 20 years, .* in 30 years, in today's dollars\./,
    );
    expect(reply.body).toContain("not a promise");
    expect(reply.refs).toEqual({ advice: true });
    const tool = JSON.parse(
      (await runChatTool(userId, "long_view", {}, { client, now: NOW })).content,
    );
    expect(tool.demoAdviceLabelRequired).toBe(true);
    expect(tool.range).toHaveLength(3);
  });

  it("gives a real account the facts and the assumptions, with no advice", async () => {
    const real = await client.user.create({
      data: { email: `long-real-${crypto.randomUUID()}@example.com` },
    });
    created.push(real.id);
    await client.account.create({
      data: {
        userId: real.id,
        source: "csv",
        name: "Checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 500_000,
      },
    });
    const view = (await loadLongView(real.id, {}, { client, now: NOW }))!;
    expect(view.advice).toBe(false);
    expect(view.levers).toEqual([]);
    expect(view.retirement).toBeNull();
    expect(view.horizons[0].lowCents).toBeGreaterThanOrEqual(500_000);
    expect(longViewReply(view).refs).toEqual({});
    expect(
      await loadLongView(
        (
          await client.user.create({
            data: { email: `long-none-${crypto.randomUUID()}@example.com` },
          })
        ).id,
        {},
        { client, now: NOW },
      ),
    ).toBeNull();
  });

  it("answers the typed questions by the rules, through the registry", async () => {
    const { answerByRules } = await import("@/lib/jane-agent/answer");
    const { parseIntent } = await import("@/lib/jane-agent/intents");
    const whatIfAnswer = await answerByRules(
      userId,
      parseIntent("what if i lose my job for 4 months", "2026-10-16"),
      { client, now: NOW },
    );
    expect(whatIfAnswer?.body).toMatch(/^Losing your job for 4 months: /);
    expect(whatIfAnswer?.actions.map((a) => a.id)).toContain("whatif.adopt");
    const longAnswer = await answerByRules(
      userId,
      parseIntent("where will i be in 30 years", "2026-10-16"),
      { client, now: NOW },
    );
    expect(longAnswer?.body).toMatch(/in 30 years, in today's dollars\./);
  });

  it("reads the typed question", () => {
    for (const text of [
      "where will i be in 30 years",
      "what will my net worth be in 20 years",
      "the long view",
    ]) {
      expect(parseLongView(text), text).toEqual({ kind: "long_view" });
    }
    expect(parseLongView("what is my net worth")).toBeNull();
  });
});

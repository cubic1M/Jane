import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
});
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { createCheckPerson, deleteCheckPerson } from "../checks/person";
import { proposeAction, runChatTool } from "../claude-tools";
import { refreshSavings } from "@/lib/insurance/savings";
import { sendToJane } from "../typing";

// "Should I ...?" about insurance goes through the decision router and comes back as the
// short, direct answer from the person's own numbers, with how sure Jane is and the demo advice
// label; a question insurance doesn't recognise gets the general answer.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("insurance decisions through the router", () => {
  let client: PrismaClient;
  let userId = "";

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = await createCheckPerson({ client, now: NOW });
  }, 120_000);
  afterAll(async () => {
    await deleteCheckPerson(userId, { client });
    await client.$disconnect();
  });

  const ask = (text: string) => sendToJane(userId, text, { client, now: NOW });

  it("answers 'should I switch car insurance' from the quote, with its confidence and the label", async () => {
    const { reply } = await ask("should I switch car insurance");
    expect(reply.body).toMatch(/\$408\.00 a year cheaper than your GEICO policy/);
    expect(reply.body).toMatch(/\d+% sure: a same-cover quote/);
    expect(reply.refs).toMatchObject({ advice: true });
    expect(reply.actions.every((a) => a.kind === "link")).toBe(true);
  });

  it("answers umbrella from the balances", async () => {
    const { reply } = await ask("should I get umbrella insurance");
    expect(reply.body).toMatch(/^Probably yes\. You have about \$529,380\.67/);
    expect(reply.body).toMatch(/\d+% sure: your balances/);
  });

  it("leaves a should-I that isn't about insurance to the general answer", async () => {
    const { reply } = await ask("should I buy bitcoin");
    expect(reply.body).not.toMatch(/umbrella|GEICO/);
  });

  it("lets Claude offer the switch for a car policy with no open finding (insurance.reshop)", async () => {
    const result = await proposeAction(
      userId,
      { action: "insurance.reshop", policy_kind: "car" },
      { client, now: NOW },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.actions.some((a) => a.id === "insurance.shop_yes")).toBe(true);
    expect(result.refs).toMatchObject({ insuranceShopId: expect.any(String) });
    // Nothing to switch to for a kind they don't have: the reason comes back for Claude to say.
    const none = await proposeAction(
      userId,
      { action: "insurance.reshop", policy_kind: "pet" },
      { client, now: NOW },
    );
    expect(none.ok).toBe(false);
  });

  it("gives the savings largest first with the top three marked, the same for everyone", async () => {
    await refreshSavings(userId, { client, now: NOW });
    const out = await runChatTool(userId, "insurance_savings", {}, { client, now: NOW });
    const { savings } = JSON.parse(out.content) as {
      savings: { aYearLess: string; mostValuable: boolean }[];
    };
    expect(savings.length).toBeGreaterThan(0);
    const dollars = savings.map((s) => Number(s.aYearLess.replace(/[^0-9.]/g, "")));
    expect(dollars).toEqual([...dollars].sort((a, b) => b - a));
    expect(savings.filter((s) => s.mostValuable)).toHaveLength(Math.min(3, savings.length));
    expect(savings.slice(0, 3).every((s) => s.mostValuable)).toBe(true);
  });
});

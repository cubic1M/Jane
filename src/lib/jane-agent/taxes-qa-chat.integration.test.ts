import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { sendToJane } from "./typing";

// Taxes QA (2026-10-22), walking the sample people through the tax chat: "why?" after "how much
// will I owe" got "Why what?"; "what's the 10-year rule" said nothing about it for someone without
// an inherited IRA; "is my social security taxed" gave a young freelancer Medicare surcharge lines
// and a withdrawal order for pre-tax money they don't have; "check my return" never mentioned
// checking a draft before filing.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

describe.runIf(url)("the tax chat's answers, against a real database", { timeout: 180_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("no plaid");
      },
    },
  ) as PlaidApi;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `qa-chat-${crypto.randomUUID()}@example.com`, timezone: "UTC" },
    });
    userId = user.id;
    const { itemId } = await linkDemoBank(userId, { client, now: NOW, person: "freelancer" });
    await syncItem(itemId, { client, api: plaid, now: NOW });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("answers 'why?' after 'how much will I owe' with what the bill is made of", async () => {
    await sendToJane(userId, "how much will I owe", { client, now: at(1) });
    const { reply } = await sendToJane(userId, "why", { client, now: at(2) });
    expect(reply.body).not.toMatch(/^Why what\?/);
    expect(reply.body).toMatch(/\$[\d,]+/);
  });

  it("explains the 10-year rule to someone without an inherited IRA, with no legal advice", async () => {
    const { reply } = await sendToJane(userId, "what's the 10-year rule", { client, now: at(3) });
    expect(reply.body).toContain(
      "The 10-year rule: most people who inherit an IRA from someone other than their spouse must empty it by the end of the 10th year after the owner died",
    );
    expect(reply.body).toContain("An estate lawyer can say what applies");
  });

  it("keeps Medicare's surcharge out of a young freelancer's answer, and flags no advice", async () => {
    const { reply } = await sendToJane(userId, "is my social security taxed", {
      client,
      now: at(4),
    });
    expect(reply.body).toContain("Social Security: I don't see it coming in yet");
    expect(reply.body).not.toContain("Medicare's surcharge");
    expect(reply.body).not.toContain("The order to draw");
    expect((reply.refs as { advice?: boolean }).advice).toBeUndefined();
  });

  it("points 'check my return' at the draft check too", async () => {
    const { reply } = await sendToJane(userId, "check my return", { client, now: at(5) });
    expect(reply.body).toContain('upload the draft as "Draft tax return"');
  });
});

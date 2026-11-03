import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type Prisma, PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { CARD_SELECT, buildCard, cardHash } from "@/lib/cards";
import { recordDecision } from "@/lib/decisions";
import { linkDemoBank } from "@/lib/plaid/demo";
import { agentStep } from "./run";

// Only trial people were sent to the simulated company. Anyone signed in could link the demo bank
// and say yes to a made-up finding, and with email set up Jane wrote to the real company's support
// address about it, with the person's name and address.

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("the agent and sample data", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  const merchants: string[] = [];

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("RESEND_API_KEY", "test");
    vi.stubEnv("EMAIL_FROM", "Jane <agent@jane.test>");
    vi.stubEnv("AGENT_INBOUND_DOMAIN", "reply.jane.test");
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.merchant.deleteMany({ where: { id: { in: merchants } } });
    await client.$disconnect();
  });

  it("never writes to a real company for someone whose every account is the demo bank", async () => {
    const name = `Realco${Array.from({ length: 10 }, () => "abcdefghij"[Math.floor(Math.random() * 10)]).join("")}`;
    const merchant = await client.merchant.create({
      data: { key: name.toLowerCase(), name, supportEmail: "support@realco.example" },
    });
    merchants.push(merchant.id);
    const user = await client.user.create({
      data: { email: `sample-mail-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    await linkDemoBank(user.id, { client });
    const finding = await client.finding.create({
      data: {
        userId: user.id,
        type: "duplicate_charge",
        key: crypto.randomUUID(),
        title: `Charged twice at ${name}`,
        annualSavingsCents: 2_000,
        amountCents: 2_000,
        confidence: "medium",
        evidence: { merchant: name, charges: [] } as Prisma.InputJsonObject,
      },
      select: CARD_SELECT,
    });
    const { actionId } = await recordDecision(
      user.id,
      { findingId: finding.id, choice: "yes", cardHash: cardHash(buildCard(finding)) },
      { client },
    );
    const send = vi.fn(async () => {});
    expect(await agentStep(user.id, actionId!, { client, send })).toBe("sent");
    expect(send).not.toHaveBeenCalled();
  });
});

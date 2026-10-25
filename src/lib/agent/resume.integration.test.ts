import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
// The concierge flow is what's tested here (the demo bank and trial people get it); read-only
// mode for real accounts is in src/lib/decisions.integration.test.ts.
vi.mock("@/lib/concierge-mode", () => ({ conciergeMode: vi.fn(async () => true) }));

import { CARD_SELECT, buildCard, cardHash } from "@/lib/cards";
import { recordDecision } from "@/lib/decisions";
import { agentStep, resumeForMerchant } from "./run";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("support emails found and confirmed, against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    // Real email mode, so a missing support email is a hand-off (nothing is sent here).
    vi.stubEnv("RESEND_API_KEY", "test");
    vi.stubEnv("EMAIL_FROM", "Jane <agent@jane.test>");
    vi.stubEnv("AGENT_INBOUND_DOMAIN", "reply.jane.test");
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("looks the address up when it's missing, and picks the request up once confirmed", async () => {
    const merchant = `Nomail${Array.from({ length: 12 }, () => "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)]).join("")}`;
    const user = await client.user.create({
      data: { email: `resume-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const finding = await client.finding.create({
      data: {
        userId: user.id,
        type: "duplicate_charge",
        key: crypto.randomUUID(),
        title: `Charged twice at ${merchant}`,
        annualSavingsCents: 2_000,
        amountCents: 2_000,
        confidence: "medium",
        evidence: { merchant, charges: [] } as Prisma.InputJsonObject,
      },
      select: CARD_SELECT,
    });
    const { actionId } = await recordDecision(
      user.id,
      { findingId: finding.id, choice: "yes", cardHash: cardHash(buildCard(finding)) },
      { client },
    );
    expect(await agentStep(user.id, actionId!, { client })).toBe("handed_off");
    const handed = await client.action.findUniqueOrThrow({ where: { id: actionId! } });
    expect(handed.handoffReason).toContain(`for ${merchant}.`);
    expect(
      await client.job.count({
        where: { kind: "find_support_contact", payload: { path: ["actionId"], equals: actionId! } },
      }),
    ).toBe(1);

    expect(await resumeForMerchant(merchant, { client })).toBe(1);
    expect(await client.action.findUniqueOrThrow({ where: { id: actionId! } })).toMatchObject({
      agentState: "working",
      handoffReason: null,
    });
  });
});

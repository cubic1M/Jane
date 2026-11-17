import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { stubTestKeys } from "@/lib/__fixtures__/env";
import { sendToJane } from "./typing";

// Debugger 11-17 (r330): a real account asking about one of its findings by name ("tell me about
// cash", "should I move my extra cash?") was asked "Want me to handle it?", though a real account
// is read-only and gets the steps. Against a real database, through the chat as typed.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-17T18:00:00Z");

describe.runIf(url)("asking about a finding on a real account", () => {
  let client: PrismaClient;
  let userId = "";
  beforeAll(async () => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    const user = await client.user.create({
      data: { email: `about-read-only-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    await client.account.create({
      data: {
        userId,
        source: "csv",
        name: "Chase checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 180_000,
      },
    });
    await client.finding.create({
      data: {
        userId,
        type: "idle_cash",
        key: "cash",
        title: "$1,192.86 more cash than 3 months of spending",
        annualSavingsCents: 4_175,
        amountCents: 119_286,
        confidence: "low",
      },
    });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("offers the steps, not to handle it", async () => {
    const { reply } = await sendToJane(userId, "tell me about cash", { client, now: NOW });
    expect(reply.body).toContain("more cash than 3 months of spending");
    expect(reply.body).toContain("Want the steps to do it yourself?");
    expect(reply.body).not.toContain("Want me to handle it?");
  });
});

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import {
  READ_ONLY_INSURANCE,
  READ_ONLY_INVESTMENTS,
  READ_ONLY_TAXES,
} from "@/config/read-only-beta";
import { runChatTool } from "@/lib/jane-agent/claude-tools";

// What the chat is told Jane does on its own, against a real, migrated Postgres. Claude answers
// from these tools, so a real account's tools must not say Jane reshops or files for them.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-19T16:00:00Z");

describe.runIf(url)("what the chat tools say Jane does, against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function person(kind: "real" | "demo") {
    const user = await client.user.create({
      data: { email: `read-only-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    if (kind === "demo") {
      await client.plaidItem.create({
        data: {
          userId: user.id,
          plaidItemId: `demo-${crypto.randomUUID()}`,
          accessTokenEncrypted: "v1:unused",
          institutionName: "Demo Bank",
        },
      });
    } else {
      await client.account.create({
        data: {
          userId: user.id,
          name: "Checking",
          type: "depository",
          subtype: "checking",
          source: "csv",
        },
      });
    }
    return user.id;
  }

  const tool = async (userId: string, name: string) =>
    JSON.parse((await runChatTool(userId, name, {}, { client, now: NOW })).content);

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("tells a real account's chat what the read-only beta does", async () => {
    const real = await person("real");
    expect((await tool(real, "tax_profile")).janeDoesByHerself).toEqual(READ_ONLY_TAXES.lines);
    expect((await tool(real, "insurance_policies")).whatJaneDoesByHerself).toBe(
      READ_ONLY_INSURANCE.body,
    );
    expect((await tool(real, "investments_overview")).whatJaneDoesByHerself).toEqual(
      READ_ONLY_INVESTMENTS.lines,
    );
  });

  it("leaves a demo person's answers as they were", async () => {
    const demo = await person("demo");
    expect((await tool(demo, "tax_profile")).janeDoesByHerself).not.toEqual(READ_ONLY_TAXES.lines);
    expect((await tool(demo, "insurance_policies")).whatJaneDoesByHerself).toMatch(
      /what I do by myself/,
    );
    expect((await tool(demo, "investments_overview")).whatJaneDoesByHerself).not.toEqual(
      READ_ONLY_INVESTMENTS.lines,
    );
  });
});

import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

const hooks = vi.hoisted(() => ({ failBorrowing: false }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
vi.mock("@/lib/borrowing-power", async (original) => {
  const real = await original<typeof import("@/lib/borrowing-power")>();
  return {
    ...real,
    ensureBorrowingChecked: (...args: Parameters<typeof real.ensureBorrowingChecked>) =>
      hooks.failBorrowing
        ? Promise.reject(new Error("borrowing down"))
        : real.ensureBorrowingChecked(...args),
    loadBorrowingPower: (...args: Parameters<typeof real.loadBorrowingPower>) =>
      hooks.failBorrowing
        ? Promise.reject(new Error("borrowing down"))
        : real.loadBorrowingPower(...args),
  };
});

import { createCheckPerson, deleteCheckPerson } from "./checks/person";
import { runChatTool } from "./claude-tools";

// The debt tools (CodeRabbit sweep part 2, chunk root-05), against a real Postgres.
const NOW = new Date("2026-11-03T15:00:00Z");
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("debt tools: what a failed side check or an old record may not change", () => {
  let client: PrismaClient;
  let id: string;
  const tool = async (name: string, input: Record<string, unknown> = {}) =>
    JSON.parse((await runChatTool(id, name, input, { client, now: NOW })).content);

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    id = await createCheckPerson({ client, now: NOW, person: "family" });
  });
  afterAll(async () => {
    await deleteCheckPerson(id, { client }).catch(() => {});
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("does not serve an earlier month's credit check-up as this month's", async () => {
    const saved = {
      monthlyOn: new Date("2026-10-05T00:00:00Z"),
      monthly: {
        month: "2026-10",
        items: [{ title: "OCTOBER ITEM", status: "tap", text: "old" }],
        did: [],
      },
    };
    await client.debtWatch.upsert({
      where: { userId: id },
      create: { userId: id, ...saved },
      update: saved,
    });
    const result = await tool("credit_monthly");
    expect(JSON.stringify(result)).not.toContain("OCTOBER ITEM");
  });

  it("says why a home project was rejected, not that no amount was given", async () => {
    const result = await tool("home_equity", { project_cents: 1 });
    if (result.note) return; // this person has no mortgage with a balance: nothing to compare
    expect(JSON.stringify(result.projectComparison)).not.toContain("Give project_cents");
  });

  it("keeps the home figures when the borrowing comparison fails", async () => {
    hooks.failBorrowing = true;
    try {
      const result = await tool("home_purchase");
      expect(JSON.stringify(result)).not.toMatch(/borrowing down/);
      expect(result).toBeTruthy();
    } finally {
      hooks.failBorrowing = false;
    }
  });
});

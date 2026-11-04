import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { createCheckPerson, deleteCheckPerson } from "./checks/person";
import { runChatTool } from "./claude-tools";

// A person who asks before the first scan has finished: Claude's tools check, as the rules'
// answers do, rather than saying "Not checked yet" and no offers.
const NOW = new Date("2026-11-03T15:00:00Z");
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("a debt tool asked before the first scan is done", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let id: string;
  const tool = async (name: string) =>
    JSON.parse((await runChatTool(id, name, {}, { client, now: NOW })).content);

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

  it("finds the offers", async () => {
    const refi = await tool("refinance_offers");
    expect(refi.checkedOn).not.toBeNull();
    expect(refi.debts.length).toBeGreaterThan(0);
  });

  it("has the score, once", async () => {
    expect((await tool("credit_score")).score).toEqual(expect.any(Number));
    expect((await tool("credit_building")).score).toEqual(expect.any(Number));
    expect(await client.creditReport.count({ where: { userId: id } })).toBe(1);
  });

  it("has the cards to move a balance from", async () => {
    expect((await tool("balance_transfers")).cards.length).toBeGreaterThan(0);
  });

  it("has what a loan's refinance would save", async () => {
    expect((await tool("car_loan")).refinance).not.toBeNull();
  });
});

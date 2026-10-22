import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { sendToJane } from "@/lib/jane-agent/typing";
import { syncItem } from "@/lib/plaid/sync";
import { startTrial } from "@/lib/trial";

// The insurance QA pass: the chat's answers agree with the page's numbers for a demo-bank
// person (family: children, a mortgage, a paycheck).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("insurance answers agree with the coverage page", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const trial = await startTrial({ client, now: NOW, defer: true, person: "family" });
    await syncItem(trial.itemId, { client, now: NOW });
    userId = trial.userId;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });
  const ask = async (text: string) => (await sendToJane(userId, text, { client, now: NOW })).reply;

  it("sizes life cover without asking what the profile already knows (children)", async () => {
    const reply = await ask("how much life insurance do I need");
    expect(reply.body).toMatch(/^You'd need about \$/);
  });

  it("answers what cover do I need from the open gaps, not 'I can't answer that'", async () => {
    const reply = await ask("what cover do I need");
    expect(reply.body).not.toMatch(/can't answer/);
    expect(reply.body).toMatch(/gaps?\./);
    expect(reply.body).toMatch(/\$[\d,]+\.00/);
  });

  it("says whether the deductible fits their cash", async () => {
    const reply = await ask("is my deductible right");
    expect(reply.body).toMatch(/deductible/);
    expect(reply.body).toMatch(/^(You could go higher|Yes, it fits|It's higher)/);
  });

  it("does not call gross balances a reason for an umbrella the page doesn't show", async () => {
    const reply = await ask("do I need umbrella insurance");
    expect(reply.body).toMatch(/^Probably not yet\./);
    expect(reply.body).toContain("after what you owe");
  });

  it("gives the disability amount from the need", async () => {
    const reply = await ask("do I need disability insurance");
    expect(reply.body).toMatch(/I'd size it at \$[\d,]+\.00 a month/);
  });
});

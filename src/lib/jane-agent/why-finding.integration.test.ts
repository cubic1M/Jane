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

// "Why?" typed right after a finding was talked about gives its reason in words, with the
// person's own charges and what changes if they say yes, and the finding's Yes under it.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("why, typed after a finding", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `why-${crypto.randomUUID()}@example.com` } })
    ).id;
    const plaid = new Proxy({}, { get: () => () => {} }) as PlaidApi;
    const { itemId } = await linkDemoBank(userId, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("explains the finding just discussed, in words with its evidence", async () => {
    let tick = 0;
    const at = () => new Date(LINKED.getTime() + ++tick * 60_000);
    const first = await sendToJane(userId, "cancel hulu", { client, now: at() });
    expect(first.reply.actions.some((a) => a.id === "finding.yes")).toBe(true);
    for (const text of ["why?", "tell me more"]) {
      const { reply, source } = await sendToJane(userId, text, { client, now: at() });
      expect(source).toBe("rules");
      expect(reply.body).toContain("If you say yes:");
      expect(reply.body).toMatch(/\$\d/);
      expect(reply.body).not.toMatch(/Which one do you mean/);
      expect(reply.actions.map((a) => a.id)).toEqual(["finding.yes", "finding.no"]);
      expect(reply.refs.findingId).toBe(first.reply.refs.findingId);
    }
  });
});

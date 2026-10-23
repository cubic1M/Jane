import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { sendToJane } from "@/lib/jane-agent/typing";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { ensureChecked } from "./refinance";

// Loans QA against a real database, on Ruth's demo bank (a $420 card, no loans): no lender
// takes so small a balance, and both the refinance answer and Claude's loan tool say so, with
// what to do instead, rather than "no offers yet" or "nothing fits" without a reason.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("a balance too small for a lender", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  let ruth: string;
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("The demo bank must never call Plaid");
      },
    },
  ) as PlaidApi;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    ruth = (
      await client.user.create({ data: { email: `small-${crypto.randomUUID()}@example.com` } })
    ).id;
    const { itemId } = await linkDemoBank(ruth, { client, now: NOW, person: "retiree" });
    await syncItem(itemId, { client, api: plaid, now: NOW });
    await ensureChecked(ruth, { client, now: NOW });
  }, 120_000);
  afterAll(async () => {
    await client.user.delete({ where: { id: ruth } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("says Jane checked and no lender takes it, not that there are no offers yet", async () => {
    const { reply } = await sendToJane(ruth, "should I refinance", { client, now: NOW });
    expect(reply.body).toMatch(/^I checked on Oct 18, 2026: none of the lenders I check take/);
    expect(reply.body).not.toContain("yet");
  });

  it("gives Claude the reason and what to do instead", async () => {
    const tool = JSON.parse(
      (await runChatTool(ruth, "loan_fit", { need: "consolidation" }, { client, now: NOW }))
        .content,
    );
    expect(tool.note).toBe("Nothing fits right now.");
    expect(tool.why).toEqual(["No lender prices a loan as small as $420.00."]);
    expect(tool.whatWouldHelp[0]).toMatch(/^Paying your card down directly is simplest\.$/);
  });
});

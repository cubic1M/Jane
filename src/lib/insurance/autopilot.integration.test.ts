import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { INSURANCE_AUTOPILOT } from "@/config/insurance";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { autopilotReply } from "@/lib/jane-agent/insurance/autopilot";
import { runJaneAgent } from "@/lib/jane-agent/run";
import { sendToJane } from "@/lib/jane-agent/typing";
import { parseRefs } from "@/lib/jane-agent/types";
import { ensureDemoPolicies } from "./profile";
import { autopilotFor, setSectorAutopilot } from "@/lib/sector-autopilot";
import { reshopPerson, shopById } from "./shop";

// Insurance on autopilot against a real, migrated Postgres (spec step 108): at "handle
// everything" Jane keeps her pick ready for the one tap; at every level renewals are
// reshopped without being asked; and Jane says what she does by herself.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-19T16:00:00Z");
const DAY = 86_400_000;

describe.runIf(url)("insurance on autopilot, against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function demoPerson(autopilot: "ask" | "safe" | "all" | null) {
    const user = await client.user.create({
      data: { email: `ins-ap-${crypto.randomUUID()}@example.com`, autopilot },
    });
    created.push(user.id);
    await client.plaidItem.create({
      data: {
        userId: user.id,
        plaidItemId: `demo-${crypto.randomUUID()}`,
        accessTokenEncrypted: "v1:unused",
      },
    });
    await client.account.create({
      data: {
        userId: user.id,
        source: "plaid",
        name: "Checking",
        type: "depository",
        subtype: "checking",
      },
    });
    await ensureDemoPolicies(user.id, { client, now: NOW });
    return user.id;
  }

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("reshops by itself at every level, even with no level picked", async () => {
    for (const level of [null, "ask", "safe", "all"] as const) {
      const userId = await demoPerson(level);
      const shops = await reshopPerson(userId, { client, now: NOW });
      expect(
        shops.map((s) => s.reason),
        String(level),
      ).toEqual(["renewal"]);
    }
  });

  it("keeps the pick ready at handle everything: quotes refreshed in place before they expire", async () => {
    const all = await demoPerson("all");
    const [shop] = await reshopPerson(all, { client, now: NOW });
    const later = new Date(NOW.getTime() + 27 * DAY);
    await reshopPerson(all, { client, now: later });
    const refreshed = await shopById(all, shop.id, { client });
    expect(refreshed?.status).toBe("open");
    expect(refreshed?.expiresAt?.getTime()).toBe(later.getTime() + 30 * DAY);

    const safe = await demoPerson("safe");
    const [kept] = await reshopPerson(safe, { client, now: NOW });
    await reshopPerson(safe, { client, now: later });
    expect((await shopById(safe, kept.id, { client }))?.expiresAt?.getTime()).toBe(
      NOW.getTime() + 30 * DAY,
    );
  });

  it("asks for the one tap at handle everything, and says what it does by itself", async () => {
    const all = await demoPerson("all");
    await reshopPerson(all, { client, now: NOW });
    await runJaneAgent(all, { client, now: NOW, trigger: "open" });
    const asked = (await client.janeMessage.findMany({ where: { userId: all } })).find(
      (m) => parseRefs(m.refs).insuranceShopId,
    );
    expect(asked?.body).toContain(
      "It's ready: tap Yes and I'll do the rest. I buy it, confirm its first payment, then cancel GEICO from the same day.",
    );
    const { reply } = await sendToJane(all, "what do you do with my insurance on your own", {
      client,
      now: NOW,
    });
    // The Insurance area keeps its default ("always ask") at "handle everything": the answer
    // says so, as Settings has it (spec step 141; docs/feature-audit.md, cluster 1).
    const area = await autopilotFor(all, "insurance", { client, now: NOW });
    expect(area.level).toBe("ask");
    expect(reply.body).toBe(autopilotReply("all", area).body);
    expect(reply.body).toContain(INSURANCE_AUTOPILOT.all);
    expect(reply.body).toMatch(/Insurance is set to always ask: I don't switch/);
    const tool = JSON.parse(
      (await runChatTool(all, "insurance_policies", {}, { client, now: NOW })).content,
    );
    expect(tool.whatJaneDoesByHerself).toBe(reply.body);
  });

  it("says it switches by itself once the Insurance area allows everything", async () => {
    const all = await demoPerson("all");
    await setSectorAutopilot(
      all,
      "insurance",
      { level: "all", actionCapCents: 20_000, monthlyCapCents: 50_000 },
      { client, now: NOW },
    );
    const { reply } = await sendToJane(all, "what do you do with my insurance on your own", {
      client,
      now: NOW,
    });
    expect(reply.body).toContain(
      "Insurance is set to everything allowed: I switch to a cheaper policy with the same cover by myself, up to $200.00 each time and $500.00 a month, and ask you about anything over that.",
    );
    expect(reply.body).not.toContain("buying still take");
  });

  it("says how to reach the insurer", async () => {
    const userId = await demoPerson("safe");
    const { reply } = await sendToJane(userId, "how do I contact my insurer", { client, now: NOW });
    expect(reply.body).toBe(
      "Here's how to reach your insurer.\n- GEICO car insurance: on your insurance card, policy documents or their app\nIf something happened, tell me what, like \"I had a car accident\", and I'll walk you through the claim.",
    );
  });
});

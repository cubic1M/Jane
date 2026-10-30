import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LINEAGE } from "@/config/lineage";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { refreshAfterRemoval } from "@/lib/import/background";
import { AS_THEY_COME } from "@/lib/jane-agent/preferences";
import { runJaneAgent } from "@/lib/jane-agent/run";
import { linkDemoBank } from "@/lib/plaid/demo";
import { removePlaidItem } from "@/lib/plaid/remove";
import { syncItem } from "@/lib/plaid/sync";
import { scanSuggestions } from "@/lib/suggestions";

// The demo bank leaves no trace (card-chat mismatch; night debugger, 10-30): someone with their
// own upload links the demo bank, Jane works everything out, and they disconnect it. Every table
// the person owns is then back to what it held before, except dated records of what happened.
// After the disconnect a real uploader's net worth had counted the demo home and car ($424k),
// /insurance said they were $400k short on car liability, /taxes listed the demo's refunds.
// A new place the demo bank seeds rows fails here until it says how they go (src/lib/evidence).

const url = process.env.TEST_DATABASE_URL;
// The real clock: what forgetSince compares is stamped by the database at the time.
const NOW = new Date();
const MODELS = [
  ...readFileSync("prisma/schema.prisma", "utf8").matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm),
]
  .filter(([, , body]) => /^\s+userId\s/m.test(body))
  .map(([, name]) => name);

describe.runIf(url)("the demo bank leaves no trace once disconnected", () => {
  let client: PrismaClient;
  let userId: string;
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("no Plaid");
      },
    },
  ) as PlaidApi;
  const counts = async () =>
    Object.fromEntries(
      await Promise.all(
        MODELS.map(async (m) => {
          const delegate = (
            client as unknown as Record<string, { count: (a: object) => Promise<number> }>
          )[m[0].toLowerCase() + m.slice(1)];
          // Jane's messages stay as the conversation's history; only open cards count.
          const where = m === "JaneMessage" ? { userId, status: "open" } : { userId };
          return [m, await delegate.count({ where })] as const;
        }),
      ),
    );

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("DEMO_BANK", "1");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `trace-${crypto.randomUUID()}@example.com` } })
    ).id;
    await client.janePreference.create({
      data: { userId, ...AS_THEY_COME, value: AS_THEY_COME.value },
    });
    const account = await client.account.create({
      data: {
        userId,
        source: "csv",
        name: "Chase Checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 1_944_751,
      },
    });
    await client.transaction.createMany({
      data: Array.from({ length: 6 }, (_, i) => ({
        userId,
        accountId: account.id,
        source: "csv" as const,
        date: new Date(NOW.getTime() - (i + 1) * 30 * 24 * 60 * 60 * 1000),
        amountCents: -420_000,
        description: "ACME CORP PAYROLL",
        pfcPrimary: "INCOME",
        pfcDetailed: "INCOME_WAGES",
      })),
    });
    await refreshAfterRemoval(userId, { client, now: NOW });
  }, 240_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("is back to what the person had before", async () => {
    const before = await counts();
    const { itemId } = await linkDemoBank(userId, { client, now: new Date() });
    await syncItem(itemId, { client, api: plaid, now: new Date() });
    await scanSuggestions(userId, { client, now: new Date() });
    await runJaneAgent(userId, { client, now: new Date(), trigger: "open" });
    await removePlaidItem(userId, itemId, "user_disconnected", { client, api: plaid });
    await refreshAfterRemoval(userId, { client, now: new Date() });
    const after = await counts();
    const left = MODELS.filter((m) => LINEAGE[m] !== "record" && LINEAGE[m] !== "system")
      .filter((m) => after[m] > before[m])
      .map((m) => `${m}: ${before[m]} -> ${after[m]}`);
    expect(left).toEqual([]);
  });
});

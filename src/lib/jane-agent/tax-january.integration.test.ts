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
import { markTaxForm, loadTaxForms } from "@/lib/tax-organizer";
import { runJaneAgent } from "./run";
import { loadSnapshot } from "./snapshot";
import { taxesSource } from "./sources/taxes";
import { sendToJane } from "./typing";

// Spec step 127 against a real, migrated Postgres: taxes run themselves. In January, one
// message says last year's taxes are ready (the estimate, the pack, which forms are in),
// once; the chat answers the standard deduction from the config.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const JAN = new Date("2027-01-05T16:00:00Z");

describe.runIf(url)("taxes on autopilot against a real database", () => {
  let client: PrismaClient;
  let userId: string;
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("The demo bank must never call Plaid");
      },
    },
  ) as PlaidApi;
  const gather = async (now: Date) =>
    taxesSource.gather((await loadSnapshot(userId, { client, now }))!, {
      now,
      local: { date: now.toISOString().slice(0, 10), hour: 8 },
      trigger: "open",
    });

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({
        data: { email: `tax-january-${crypto.randomUUID()}@example.com` },
      })
    ).id;
    const { itemId } = await linkDemoBank(userId, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("in January, one message with last year's taxes ready", async () => {
    const forms = await loadTaxForms(userId, 2026, { client, now: JAN });
    await markTaxForm(userId, 2026, forms.forms[0].key, true, { client, now: JAN, via: "page" });
    const january = (await gather(JAN)).find((c) => c.dedupeKey === "january:2026")!;
    expect(january.body).toMatch(/^Your 2026 taxes are ready to go\. My estimate: federal, /);
    expect(january.body).toContain("Your tax-time pack has donations $100");
    expect(january.body).toContain("1 of 4 tax forms are in");
    expect(january.actions.map((a) => (a.id === "open" ? a.href : a.id))).toEqual([
      "/tax-pack?year=2026",
      "/taxes",
    ]);
    // Not in October.
    expect((await gather(LINKED)).some((c) => c.dedupeKey.startsWith("january:"))).toBe(false);
    // Posted once by Jane's own run.
    for (const day of [5, 6, 7, 8, 9, 10, 11]) {
      await runJaneAgent(userId, {
        client,
        now: new Date(`2027-01-${String(day).padStart(2, "0")}T16:00:00Z`),
        trigger: "open",
      });
    }
    expect(
      await client.janeMessage.count({ where: { userId, dedupeKey: "taxes:january:2026" } }),
    ).toBe(1);
  }, 120_000);

  it("answers whether to itemize from the config, with the person's own", async () => {
    const { reply } = await sendToJane(userId, "should I itemize", {
      client,
      now: LINKED,
    });
    expect(reply.body).toMatch(
      /^The 2026 standard deduction is \$16,100\.00 for single filers, \$32,200\.00 married filing jointly and \$24,150\.00 head of household\. Filing as single, yours is \$16,100\.00/,
    );
  });
});

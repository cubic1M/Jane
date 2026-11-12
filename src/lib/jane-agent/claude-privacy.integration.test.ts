import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { correctFact } from "@/lib/profile";
import { chatPrimer, runChatTool } from "./claude-tools";
import { payeeMask } from "./payee-mask";
import { forgetPrimer } from "./primer-cache";

// Beta (11-12), against a real, migrated Postgres: what the chat sends Claude about a person never
// names who they pay by Zelle or Venmo, and never holds a health, religion or other sensitive fact,
// even one they told Jane or one worked out from their spending.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");
const NAMES = /daniel|smith|emily|rose/i;
const SENSITIVE = /medical|debt trouble|baptist|church|therapy/i;

describe.runIf(url)("what Claude is sent about a person", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `privacy-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    const account = await client.account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository", subtype: "checking" },
    });
    const tx = (day: string, description: string, amountCents: number, pfc: [string, string]) =>
      client.transaction.create({
        data: {
          userId,
          accountId: account.id,
          source: "csv",
          date: new Date(`${day}T00:00:00Z`),
          amountCents,
          description,
          pfcPrimary: pfc[0],
          pfcDetailed: pfc[1],
        },
      });
    const rent: [string, string] = ["RENT_AND_UTILITIES", "RENT_AND_UTILITIES_RENT"];
    for (const month of ["07", "08", "09", "10"]) {
      // Rent paid to a person, answered yes to "Is this your rent?": shown by name in the app.
      await tx(`2026-${month}-01`, "ZELLE TO DANIEL SMITH", 150_000, rent);
      await tx(`2026-${month}-05`, "VENMO PAYMENT FROM EMILY ROSE", -4_000, [
        "TRANSFER_IN",
        "TRANSFER_IN_ACCOUNT_TRANSFER",
      ]);
      await tx(`2026-${month}-09`, "NETFLIX.COM", 1_799, [
        "ENTERTAINMENT",
        "ENTERTAINMENT_TV_AND_MOVIES",
      ]);
    }
    // Told Jane: two sensitive things, and one that isn't.
    await correctFact(userId, "hardship_reason", "medical", { client, now: NOW });
    await correctFact(userId, "employer", "First Baptist Church", { client, now: NOW });
    await correctFact(userId, "has_pet", "yes", { client, now: NOW });
    for (const label of ["Never suggest cutting my therapy", "Never suggest cancelling Netflix"]) {
      await client.janePreference.create({
        data: { userId, kind: "never", key: crypto.randomUUID(), value: {}, label },
      });
    }
    forgetPrimer();
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("knows this person's payment-app payees, and not the companies they pay", async () => {
    const mask = await payeeMask(userId, client);
    const hidden = mask.hide("Your rent goes to Daniel Smith. From Emily Rose. Netflix went up.");
    expect(hidden).not.toMatch(NAMES);
    expect(hidden).toContain("Netflix went up.");
    expect(mask.show(hidden)).toBe(
      "Your rent goes to Daniel Smith. From Emily Rose. Netflix went up.",
    );
    // Whatever a lookup gives back about rent, it reaches Claude without the name.
    const found = await runChatTool(
      userId,
      "search_transactions",
      { query: "rent" },
      {
        client,
        now: NOW,
      },
    );
    expect(mask.hide(found.content)).not.toMatch(NAMES);
  });

  it("leaves sensitive facts and wishes out of the numbers sent with every question", async () => {
    const primer = await chatPrimer(userId, { client, now: NOW });
    expect(primer.text).not.toMatch(SENSITIVE);
    // The filter isn't dropping everything: the rest of what they told Jane is there.
    expect(primer.text).toMatch(/pet/i);
    expect(primer.text).toContain("Never suggest cancelling Netflix");
  });

  it("leaves them out of 'what do you know about me'", async () => {
    const profile = await runChatTool(userId, "my_profile", {}, { client, now: NOW });
    expect(profile.content).not.toMatch(SENSITIVE);
    expect(profile.content).toMatch(/pet/i);
  });
});

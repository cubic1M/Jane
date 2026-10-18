import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Products } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { deleteAllData } from "@/lib/account-deletion";
import { decrypt } from "@/lib/crypto";
import { PlaidRequestError, plaid, plaidCall } from "./client";
import { exchangePublicToken } from "./link";
import { syncItem } from "./sync";

// Opt-in check against Plaid's real Sandbox: links a test bank, syncs it into a scratch
// database and runs detection. Needs Sandbox keys and a scratch database:
//   PLAID_SANDBOX_TEST=1 PLAID_CLIENT_ID=… PLAID_SECRET=… TEST_DATABASE_URL=… npx vitest run src/lib/plaid/sandbox.live.test.ts
const url = process.env.TEST_DATABASE_URL;
const enabled = process.env.PLAID_SANDBOX_TEST === "1" && Boolean(url);

describe.runIf(enabled)("Plaid Sandbox, end to end", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    vi.stubEnv("PLAID_ENV", "sandbox");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `sandbox-${crypto.randomUUID()}@example.com` } })
    ).id;
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("links a test institution, syncs it twice without duplicates and finds savings", async () => {
    // Plaid's Sandbox user with recurring subscriptions and a year of history.
    const { public_token } = await plaidCall(
      plaid().sandboxPublicTokenCreate({
        institution_id: "ins_109508",
        initial_products: [Products.Transactions],
        options: {
          override_username: "user_transactions_dynamic",
          override_password: "pass_good",
          transactions: { days_requested: 365 },
        },
      }),
    );
    const itemId = await exchangePublicToken(userId, public_token, "First Platypus Bank", {
      client,
    });

    // Sandbox prepares transactions asynchronously; sync until some arrive.
    let first = await syncItem(itemId, { client });
    for (let i = 0; i < 10 && first.added === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      first = await syncItem(itemId, { client });
    }
    const count = await client.transaction.count({ where: { userId } });
    console.log("Sandbox sync", { ...first, transactions: count });
    expect(count).toBeGreaterThan(0);

    // Plaid's recurring streams are ready a few seconds later (in production its webhook
    // triggers this sync). A rerun must not duplicate anything.
    let again = await syncItem(itemId, { client });
    for (let i = 0; i < 10 && again.recurring !== "updated"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      again = await syncItem(itemId, { client });
    }
    expect(again.recurring).toBe("updated");
    expect(await client.transaction.count({ where: { userId } })).toBe(count);

    const findings = await client.finding.findMany({
      where: { userId },
      select: { type: true, title: true, annualSavingsCents: true },
    });
    console.log("Sandbox findings", findings);
    expect(findings.map((f) => f.type)).toContain("subscription_review");

    // "Delete all my data": Plaid forgets the item and no rows remain.
    const stored = await client.plaidItem.findUniqueOrThrow({ where: { id: itemId } });
    const accessToken = decrypt(stored.accessTokenEncrypted);
    await deleteAllData(userId, { client });
    expect(await client.user.count({ where: { id: userId } })).toBe(0);
    expect(await client.transaction.count({ where: { userId } })).toBe(0);
    const after = await plaidCall(plaid().transactionsSync({ access_token: accessToken })).catch(
      (e: unknown) => e,
    );
    expect(after).toBeInstanceOf(PlaidRequestError);
    console.log("Plaid after removal", { code: (after as PlaidRequestError).code });
  }, 120_000);
});

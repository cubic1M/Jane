import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { encrypt } from "@/lib/crypto";
import { DEMO_TOKEN_PREFIX } from "@/lib/plaid/demo";
import { startClaim } from "./claims";
import { canFile } from "./claim-filing";
import { partnerFor } from "./partner";

// The demo bank beside a real account: labelled sample quotes are fine, but the stand-in insurer
// would say a claim on a real policy was filed with a real insurer.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-19T16:00:00Z");

describe.runIf(url)("the stand-in insurer", () => {
  let client: PrismaClient;
  let userId: string;
  let policyId: string;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `partner-${crypto.randomUUID()}@example.com` } })
    ).id;
    await client.plaidItem.create({
      data: {
        userId,
        plaidItemId: `demo-${crypto.randomUUID()}`,
        accessTokenEncrypted: encrypt(`${DEMO_TOKEN_PREFIX}1:2026-01-01`),
      },
    });
    policyId = (
      await client.insurancePolicy.create({
        data: {
          userId,
          kind: "auto",
          carrier: "GEICO",
          source: "typed",
          status: "active",
          premiumCents: 14_200,
          premiumFrequency: "monthly",
        },
      })
    ).id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("files for the demo bank alone, and only quotes once a real account joins", async () => {
    const claim = await startClaim(
      userId,
      { policyId, kind: "auto", event: "accident", happenedOn: "2026-10-17" },
      { client, now: NOW },
    );
    expect(await canFile(userId, claim, { client })).toBe(true);

    await client.account.create({
      data: { userId, source: "csv", name: "Real checking", type: "depository" },
    });

    expect(await canFile(userId, claim, { client })).toBe(false);
    expect(await partnerFor(userId, { client })).not.toBeNull();
  });
});

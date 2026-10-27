import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
import { computeBetaMetrics, loadBetaRows } from "./beta-metrics";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts). Other
// tests' rows share the database, so it checks this test's own people in the rows read.
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("beta metrics against a real database", () => {
  let client: PrismaClient;
  const suffix = crypto.randomUUID().slice(0, 8);
  const ids: string[] = [];
  let inviteId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const person = async (name: string, id?: string) => {
      const user = await client.user.create({
        data: { ...(id ? { id } : {}), email: `beta-${name}-${suffix}@example.com` },
      });
      ids.push(user.id);
      return user.id;
    };
    const uploader = await person("uploader");
    const linker = await person("linker");
    const demo = await person("demo");
    await person("trial", `trial_beta${suffix}`);

    inviteId = (await client.inviteCode.create({ data: { code: `BETA-${suffix}`, maxUses: 5 } }))
      .id;
    await client.betaAccess.create({
      data: { email: `beta-uploader-${suffix}@example.com`, inviteCodeId: inviteId },
    });

    await client.account.create({
      data: { userId: uploader, source: "csv", name: "Checking", type: "depository" },
    });
    const realItem = await client.plaidItem.create({
      data: { userId: linker, plaidItemId: `item-${suffix}`, accessTokenEncrypted: "x" },
    });
    await client.account.create({
      data: { userId: linker, source: "plaid", itemId: realItem.id, name: "Card", type: "credit" },
    });
    const demoItem = await client.plaidItem.create({
      data: { userId: demo, plaidItemId: `demo-${suffix}`, accessTokenEncrypted: "demo:x" },
    });
    await client.account.create({
      data: {
        userId: demo,
        source: "plaid",
        itemId: demoItem.id,
        name: "Demo",
        type: "depository",
      },
    });

    const found = await client.finding.create({
      data: {
        userId: uploader,
        type: "bank_fees",
        key: "fees",
        title: "Fees",
        annualSavingsCents: 14400,
        confidence: "high",
      },
    });
    await client.decision.create({
      data: { findingId: found.id, userId: uploader, choice: "diy", cardSnapshot: {} },
    });
    await client.suggestionOutcome.create({
      data: {
        userId: uploader,
        suggestionKey: `fees-${suffix}`,
        capability: "fees",
        topic: "fees",
        title: "Fees",
        firstShownAt: new Date(),
        lastShownAt: new Date(),
        expectedCents: 14400,
        worthKind: "yearly",
        confidencePercent: 90,
        status: "confirmed",
        confirmedCents: 14400,
      },
    });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: ids } } });
    await client.inviteCode.deleteMany({ where: { id: inviteId } });
    await client.$disconnect();
  });

  it("reads each person's accounts with demo items marked, and no trial people", async () => {
    const rows = await loadBetaRows({ client });
    const own = <T extends { userId: string }>(list: T[]) =>
      list.filter((r) => ids.includes(r.userId));
    expect(rows.users.some((u) => u.id.startsWith("trial_"))).toBe(false);
    expect(
      own(rows.accounts)
        .map((a) => [a.source, a.demo])
        .sort(),
    ).toEqual([
      ["csv", false],
      ["plaid", false],
      ["plaid", true],
    ]);

    // Only this test's people, so other tests' rows don't change the numbers.
    const mine = computeBetaMetrics({
      users: rows.users.filter((u) => ids.includes(u.id)),
      invited: rows.invited.filter((i) => i.email.endsWith(`-${suffix}@example.com`)),
      accounts: own(rows.accounts),
      findings: own(rows.findings),
      decisions: own(rows.decisions),
      outcomes: own(rows.outcomes),
    });
    expect(mine).toEqual({
      invited: 1,
      signedUp: 2,
      uploaded: { users: 1, accounts: 1 },
      linked: { users: 1, accounts: 1 },
      withFinding: 1,
      found: { users: 2, totalCents: 14400, medianCents: 7200 },
      acted: 1,
      verified: { users: 1, cents: 14400 },
    });
  });
});

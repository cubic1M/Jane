import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { findingFingerprint } from "./fingerprint";
import { stillTrue } from "./still-true";
import { toChatMessage } from "./types";

// Debug 2 re-walk (11-16, Plaid sandbox checking + brokerage, 1280 light): the first sync brought
// 30 days and the dock's card read "Review your Netflix subscription. Could save about $185.88 a
// year. 50% sure: 1 charge in 1 month of data." The rest of the history came on the next sync and
// the finding grew to three charges, but the card kept its first "% sure": a changed finding's
// card was said again with its old sure-line. It's said as it is now.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-16T22:20:00Z");
const OLD = { percent: 50, reason: "1 charge in 1 month of data" };

describe.runIf(url)("a finding's card says how sure as it is now", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  let findingId: string;

  const card = async (fingerprint: string) =>
    toChatMessage(
      await client.janeMessage.create({
        data: {
          userId,
          kind: "decision",
          body: `Review your Netflix subscription. Could save about $185.88 a year. ${OLD.percent}% sure: ${OLD.reason}. Want the steps to do it yourself?`,
          refs: { findingId, fingerprint, confidence: OLD },
          actions: [{ id: "finding.yes", label: "Yes", kind: "primary" }],
          dedupeKey: `findings:${findingId}:${fingerprint.slice(0, 8)}`,
        },
      }),
    );

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    userId = (
      await client.user.create({
        data: { email: "still-true-finding-sure-d2@example.com", createdAt: NOW },
      })
    ).id;
    const account = await client.account.create({
      data: {
        userId,
        source: "plaid",
        name: "Plaid checking",
        type: "depository",
        subtype: "checking",
      },
    });
    const charges = ["2026-09-10", "2026-10-10", "2026-11-10"];
    for (const date of charges) {
      await client.transaction.create({
        data: {
          userId,
          accountId: account.id,
          source: "plaid",
          date: new Date(`${date}T00:00:00Z`),
          amountCents: 1_549,
          description: "Netflix",
          merchantName: "Netflix",
          pfcDetailed: "ENTERTAINMENT_TV_AND_MOVIES",
        },
      });
    }
    findingId = (
      await client.finding.create({
        data: {
          userId,
          type: "subscription_review",
          key: "merchant:netflix",
          title: "Review your Netflix subscription",
          annualSavingsCents: 18_588,
          confidence: "high",
          evidence: {
            charges: charges.map((date) => ({ date, amountCents: 1_549, description: "Netflix" })),
          },
          status: "new",
        },
      })
    ).id;
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("when the finding changed since the card was posted", async () => {
    const [shown] = await stillTrue(userId, [await card("the finding as it was")], {
      client,
      now: NOW,
    });
    expect(shown.body).toMatch(
      /^Review your Netflix subscription\. Could save about \$185\.88 a year\. \d{1,3}% sure: 3 charges in \d+ months? of data\. Want the steps to do it yourself\?$/,
    );
    expect(shown.refs.confidence).toMatchObject({ reason: expect.stringContaining("3 charges") });
  });

  it("when only what it's worked out from moved", async () => {
    const finding = await client.finding.findUniqueOrThrow({ where: { id: findingId } });
    const [shown] = await stillTrue(userId, [await card(findingFingerprint(finding))], {
      client,
      now: NOW,
    });
    expect(shown.body).not.toContain(OLD.reason);
    expect(shown.body).toContain("3 charges in");
  });
});

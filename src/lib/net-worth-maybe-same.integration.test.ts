import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { stubTestKeys } from "@/lib/__fixtures__/env";
import { runBooksCheck } from "@/lib/books";
import { booksFix } from "@/lib/books-fix";
import { encrypt } from "@/lib/crypto";
import { loadMaybeSame, loadNetWorthInputs } from "@/lib/net-worth-history";

// Gate B, 11-24: a Wells Fargo-style upload has no last four, so it can't be matched to the same
// account once linked, and net worth counted both (twice the truth). Both are still counted, and
// the person is told where they look: under net worth, and on the books notice, with where to
// remove one.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-24T18:00:00Z");

describe.runIf(url)(
  "an upload with no last four, and the account linked",
  { timeout: 120_000 },
  () => {
    let client: PrismaClient;
    let userId: string | undefined;

    beforeAll(async () => {
      stubTestKeys();
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
      userId = (
        await client.user.create({
          data: {
            email: `maybe-same-${Date.now().toString(36)}@example.com`,
            timezone: "America/Los_Angeles",
          },
        })
      ).id;
      const { id: itemId } = await client.plaidItem.create({
        data: {
          userId,
          plaidItemId: "item-maybe-same",
          accessTokenEncrypted: encrypt("access-maybe-same"),
          institutionName: "Wells Fargo",
          lastSyncedAt: NOW,
        },
      });
      const account = (data: object) =>
        client.account.create({
          data: {
            userId: userId!,
            type: "depository",
            subtype: "checking",
            currentBalanceCents: 8_000_000,
            ...data,
          } as never,
        });
      await account({ source: "csv", name: "Wells Fargo checking", mask: null });
      await account({
        source: "plaid",
        itemId,
        plaidAccountId: "maybe-same",
        name: "Everyday Checking",
        mask: "4321",
      });
      // A genuinely different account at the same bank: not flagged.
      await account({
        source: "csv",
        name: "Wells Fargo savings",
        subtype: "savings",
        mask: null,
        currentBalanceCents: 100_000,
      });
    });
    afterAll(async () => {
      if (userId) await client.user.deleteMany({ where: { id: userId } });
      await client.$disconnect();
      vi.unstubAllEnvs();
    });

    it("counts both, as today, and says so under net worth and on the books notice", async () => {
      const { worth } = await loadNetWorthInputs(userId!, { client });
      expect(worth.netCents).toBe(8_000_000 * 2 + 100_000);
      const words = await loadMaybeSame(userId!, { client });
      expect(words).toBe(
        "Wells Fargo checking (uploaded) and Everyday Checking (linked) may be the same account; net worth counts both. If they are the same, remove one.",
      );
      const books = await runBooksCheck(userId!, { client, now: NOW });
      const issue = books.open.find((i) => i.kind === "maybe_same")!;
      expect(issue.words).toBe(words);
      expect(booksFix({ ...issue } as never)).toEqual({ label: "Remove one", href: "/import" });
    });
  },
);

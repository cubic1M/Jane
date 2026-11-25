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
import { scopedFor } from "@/lib/db-scoped";
import { keepAccountSeparate, undoKeepSeparate } from "@/lib/import/separate";
import { loadMaybeSame, loadNetWorthInputs } from "@/lib/net-worth-history";

// The founder's rule, 11-24: net worth matches what Plaid sends. A Wells Fargo-style upload has no
// last four, so it can't be told from the same account once linked; it is left out, and the person
// is told under net worth and on the books notice, with one tap to say it is another account.

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

    it("leaves the upload out, says why under net worth and on the books notice", async () => {
      const { worth } = await loadNetWorthInputs(userId!, { client });
      // The link's balance and the savings upload that can't be a copy of it; not the checking upload.
      expect(worth.netCents).toBe(8_000_000 + 100_000);
      const said = await loadMaybeSame(userId!, { client });
      expect(said?.href).toBe("/import");
      expect(said?.words).toBe(
        "Wells Fargo checking (uploaded) looks like a copy of Everyday Checking (linked), so Jane left it out of net worth.",
      );
      expect(said?.short).toBe(
        "Wells Fargo checking (uploaded) looks like a copy of Everyday Checking (linked), so Jane left it out of net worth.",
      );
      const books = await runBooksCheck(userId!, { client, now: NOW });
      const issue = books.open.find((i) => i.kind === "maybe_same")!;
      expect(issue.words).toBe(said?.words);
      expect(booksFix({ ...issue } as never)).toEqual({
        label: "See it",
        href: "/import",
      });
    });

    it("counts it, and says nothing, once the person says it is a different account", async () => {
      const upload = await client.account.findFirstOrThrow({
        where: { userId, name: "Wells Fargo checking" },
      });
      expect(await keepAccountSeparate(scopedFor(userId!, client), upload.id)).toBe(true);
      const { worth } = await loadNetWorthInputs(userId!, { client });
      expect(worth.netCents).toBe(8_000_000 * 2 + 100_000);
      expect(await loadMaybeSame(userId!, { client })).toBeNull();
      const books = await runBooksCheck(userId!, { client, now: NOW });
      expect(books.open.map((i) => i.kind)).not.toContain("maybe_same");
      // Taken back, it is left out again.
      expect(await undoKeepSeparate(scopedFor(userId!, client), upload.id)).toBe(true);
      expect((await loadNetWorthInputs(userId!, { client })).worth.netCents).toBe(8_100_000);
    });

    it("says nothing when the upload has no balance: only the linked one is counted", async () => {
      await client.account.updateMany({
        where: { userId, name: "Wells Fargo checking" },
        data: { currentBalanceCents: null },
      });
      const { worth } = await loadNetWorthInputs(userId!, { client });
      expect(worth.netCents).toBe(8_000_000 + 100_000);
      expect(await loadMaybeSame(userId!, { client })).toBeNull();
      const books = await runBooksCheck(userId!, { client, now: NOW });
      expect(books.open.map((i) => i.kind)).not.toContain("maybe_same");
    });
  },
);

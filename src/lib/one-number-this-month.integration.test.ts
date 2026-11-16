import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PEOPLE, type PersonId } from "@/config/people";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { stubTestKeys } from "@/lib/__fixtures__/env";
import { loadMoneyArea } from "@/lib/area-pages/money-load";
import { encrypt } from "@/lib/crypto";
import { monthLabel } from "@/lib/day-label";
import { loadHubAreas } from "@/lib/hub/load";
import { shortMoney, tilesView } from "@/lib/hub/view";
import { loadMoneyHub } from "@/lib/hubs/money";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";

// Gate B, "one number, one source" (docs/one-number.md): "spent this month" is one month and one
// figure on Home's Money tile, the Money page's tree and the money hub. On the 1st, with a paycheck
// in and nothing spent yet, the tile went back to last month, the tree stayed on this month ($0, it
// had money in), and the hub always showed this month; now each shows the newest month with
// spending (shownSpendingMonth), by name.

const url = process.env.TEST_DATABASE_URL;
// Sunday Nov 1, 2026, 9am in Los Angeles, and the Wednesday after.
const FIRST = new Date("2026-11-01T17:00:00Z");
const LATER = new Date("2026-11-04T17:00:00Z");

describe.runIf(url)("this month's spending, one number", { timeout: 300_000 }, () => {
  let client: PrismaClient;
  const made: string[] = [];

  beforeAll(() => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  const user = async (name: string) => {
    const row = await client.user.create({
      data: { email: `one-number-month-${name}@example.com`, timezone: "America/Los_Angeles" },
    });
    made.push(row.id);
    return row.id;
  };

  // The month and figure each surface shows, the tile's month read from its caption.
  const shown = async (userId: string, now: Date) => {
    const o = { client, now };
    const [areas, money, hub] = await Promise.all([
      loadHubAreas(userId, { budgetsOver: 0, safeShort: false }, o),
      loadMoneyArea(userId, o),
      loadMoneyHub(userId, o),
    ]);
    const tile = tilesView(areas).find((t) => t.key === "money")!;
    const month = money!.spending!.month;
    const named = monthLabel(month, { long: true, year: false });
    return {
      tree: { month, cents: money!.spending!.spendingCents },
      tile: {
        month:
          tile.caption === "Spent this month" || tile.caption === `Spent in ${named}`
            ? month
            : tile.caption,
        figure: tile.value,
      },
      hub: { month: hub.spendingMonth, cents: hub.spendingCents },
    };
  };
  const expectOneMonth = async (userId: string, now: Date) => {
    const { tree, tile, hub } = await shown(userId, now);
    expect({ tile, hub }).toEqual({
      tile: { month: tree.month, figure: shortMoney(tree.cents) },
      hub: tree,
    });
    return tree;
  };

  it.each(PEOPLE.map((p) => p.id))(
    "%s: one month, one figure, on the 1st and after",
    async (id) => {
      const userId = await user(id);
      const { itemId } = await linkDemoBank(userId, { client, now: FIRST, person: id as PersonId });
      await syncItem(itemId, { client, now: FIRST });
      await expectOneMonth(userId, FIRST);
      await expectOneMonth(userId, LATER);
    },
  );

  it("on the 1st, a paycheck in and nothing spent, is last month everywhere", async () => {
    const userId = await user("paid-on-the-first");
    const { id: itemId } = await client.plaidItem.create({
      data: {
        userId,
        plaidItemId: "item-month-first",
        accessTokenEncrypted: encrypt("access-month-first"),
        institutionName: "Chase",
      },
    });
    const { id: accountId } = await client.account.create({
      data: {
        userId,
        itemId,
        source: "plaid",
        plaidAccountId: "month-first",
        name: "Total Checking",
        mask: "4321",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 250_000,
      },
    });
    const row = (
      date: string,
      amountCents: number,
      description: string,
      pfc: string,
      n: number,
    ) => ({
      userId,
      accountId,
      source: "plaid" as const,
      plaidTransactionId: `month-first-${n}`,
      date: new Date(`${date}T00:00:00Z`),
      amountCents,
      description,
      pfcPrimary: pfc
        .split("_")
        .slice(0, pfc.startsWith("FOOD_AND_DRINK") ? 3 : 1)
        .join("_"),
      pfcDetailed: pfc,
      pending: false,
      categorySource: "plaid" as const,
    });
    await client.transaction.createMany({
      data: [
        row("2026-10-01", -125_000, "ACME PAYROLL", "INCOME_SALARY", 1),
        row("2026-10-12", 30_000, "SAFEWAY STORE", "FOOD_AND_DRINK_GROCERIES", 2),
        row("2026-11-01", -125_000, "ACME PAYROLL", "INCOME_SALARY", 3),
      ],
    });
    expect(await expectOneMonth(userId, FIRST)).toEqual({ month: "2026-10", cents: 30_000 });
  });
});

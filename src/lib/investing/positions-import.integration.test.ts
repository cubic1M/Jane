import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/jobs", () => ({
  enqueueJob: vi.fn(async () => "job_1"),
  runJob: vi.fn(async () => "done"),
}));

import { logAudit } from "@/lib/audit";
import { scopedFor } from "@/lib/db-scoped";
import { loadInvestments } from "@/lib/investments/holdings";
import { fidelity, schwab } from "./__fixtures__/positions";
import { importPositionsText } from "./positions-import";

// A positions file saved as holdings, against a real, migrated Postgres (read-only beta): the
// holdings show on the investments page's data, the balance counts, a second upload replaces
// instead of adding, and another person sees nothing.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-27T18:00:00Z");

describe.runIf(url)("importing a positions file, against a real database", () => {
  let client: PrismaClient;
  let userId: string;
  let otherId: string;
  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const make = async (who: string) =>
      (
        await client.user.create({
          data: { email: `positions-${who}-${crypto.randomUUID()}@example.com` },
        })
      ).id;
    userId = await make("me");
    otherId = await make("other");
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    await client.$disconnect();
  });

  it("makes an account per account in the file, with its holdings and total", async () => {
    const r = await importPositionsText(scopedFor(userId, client), fidelity, NOW);
    expect(r.ok && r.accounts.map((a) => [a.name, a.holdings, a.valueCents])).toEqual([
      ["Fidelity Individual ···5678", 3, 1_861_622 + 230_000 + 50_000],
      ["Fidelity Roth IRA ···5432", 1, 600_000],
    ]);
    const accounts = await client.account.findMany({ where: { userId }, orderBy: { name: "asc" } });
    expect(accounts.map((a) => [a.name, a.subtype, a.currentBalanceCents])).toEqual([
      ["Fidelity Individual ···5678", "brokerage", 2_141_622],
      ["Fidelity Roth IRA ···5432", "retirement", 600_000],
    ]);
    const inv = await loadInvestments(userId, { client, now: NOW });
    expect(inv.totalCents).toBe(2_741_622);
    const roth = inv.accounts.find((a) => a.name.includes("Roth"))!;
    expect(roth.holdings.map((h) => h.ticker)).toEqual(["VTI"]);
    expect(roth.holdingsMatch).toBe(true);
    const cash = inv.accounts.flatMap((a) => a.holdings).find((h) => h.isCash)!;
    expect(cash.valueCents).toBe(50_000);
    expect(logAudit).toHaveBeenCalledWith(
      expect.anything(),
      "positions_imported",
      expect.anything(),
      expect.objectContaining({ accounts: 2, holdings: 4, broker: "Fidelity" }),
    );
  });

  it("replaces an account's holdings on a second upload, never adds", async () => {
    const again = await importPositionsText(scopedFor(userId, client), fidelity, NOW);
    expect(again.ok).toBe(true);
    expect(await client.account.count({ where: { userId } })).toBe(2);
    expect(await client.holding.count({ where: { userId } })).toBe(4);
  });

  it("keeps one person's holdings from another, and refuses a file that isn't positions", async () => {
    expect((await loadInvestments(otherId, { client, now: NOW })).totalCents).toBe(0);
    const bad = await importPositionsText(
      scopedFor(otherId, client),
      "Date,Description,Amount\n10/01/2026,COFFEE,-4.00\n",
      NOW,
    );
    expect(bad.ok).toBe(false);
    const s = await importPositionsText(scopedFor(otherId, client), schwab, NOW);
    expect(s.ok && s.accounts[0].name).toBe("Schwab Individual ...123");
  });
});

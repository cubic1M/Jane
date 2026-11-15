import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { NO_PLAID as plaid } from "@/lib/__fixtures__/plaid";
import { fitPersonFrom } from "@/planning/fit-person";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadDebts } from "./debts";
import { loadFit } from "./fit";
import { loadProfileInput } from "./profile";

// Debugger 11-15: main's e2e went red half a minute after UTC midnight on the 15th. The demo
// person's data runs to the day before; read on payday, the year left out last year's paycheck
// and this year's wasn't in, so pay read 4% low, the car refinance went over the lenders' debt
// limit and Jane's pick flipped to "keep it". The same person and data, read either side of
// midnight, gives the same pay and the same pick.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-11-14T23:00:00Z");
const READS = [LINKED, new Date("2026-11-15T01:00:00Z")];

describe.runIf(url)("the demo person read the night before payday and on payday", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({
        data: { email: `refi-payday-${crypto.randomUUID()}@example.com`, timezone: "UTC" },
      })
    ).id;
    const { itemId } = await linkDemoBank(userId, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
  }, 180_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("has the same pay either side of midnight", async () => {
    const pay = await Promise.all(
      READS.map(
        async (now) => fitPersonFrom(await loadProfileInput(userId, { client, now })).incomeCents,
      ),
    );
    expect(pay[0]).toBeGreaterThan(0);
    expect(pay[1]).toBe(pay[0]);
  });

  it("picks the same refinance for the car either side of midnight", async () => {
    const car = (await loadDebts(userId, { client, now: LINKED })).debts.find(
      (d) => d.kind === "auto",
    )!;
    const picks = await Promise.all(
      READS.map(async (now) => {
        const fit = await loadFit(userId, { need: "refinance", debtKey: car.key }, { client, now });
        return fit.options.find((o) => o.id === fit.pick)?.lender ?? fit.pick;
      }),
    );
    expect(picks).toEqual(["Harbor Auto Refi", "Harbor Auto Refi"]);
  });
});

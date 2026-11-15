import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { NO_PLAID as plaid } from "@/lib/__fixtures__/plaid";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { checkBorrowing, loadBorrowingPower } from "./borrowing-power";
import { loadFit } from "./fit";
import { checkRates, loadRefinance } from "./refinance";

// Debugger 11-15: at 7:42pm in Los Angeles on Nov 14 the refinance page read "Last checked Nov 15,
// 2026": the check was dated by UTC's day. The rate checks and the loan fit are dated by the
// person's own day, as every page shows them.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-11-10T18:00:00Z");
// 7pm on Nov 14 in Los Angeles; Nov 15 in UTC.
const EVENING = new Date("2026-11-15T03:00:00Z");

describe.runIf(url)("a check made in the evening in Los Angeles", () => {
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
        data: {
          email: `checked-day-${crypto.randomUUID()}@example.com`,
          timezone: "America/Los_Angeles",
        },
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

  it("dates the refinance check by the person's day", async () => {
    await checkRates(userId, { client, now: EVENING });
    expect((await loadRefinance(userId, { client, now: EVENING })).checkedOn).toBe("2026-11-14");
  });

  it("dates what they could borrow by the person's day", async () => {
    await checkBorrowing(userId, { client, now: EVENING });
    expect((await loadBorrowingPower(userId, { client, now: EVENING })).checkedOn).toBe(
      "2026-11-14",
    );
  });

  it("dates the loan fit by the person's day", async () => {
    const fit = await loadFit(
      userId,
      { need: "car", amountCents: 2_000_000 },
      { client, now: EVENING },
    );
    expect(fit.checkedOn).toBe("2026-11-14");
  });
});

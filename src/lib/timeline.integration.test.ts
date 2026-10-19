import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { SECTORS } from "@/config/autopilot-sectors";
import { recordAct } from "@/lib/sector-autopilot";
import { loadTimeline } from "./timeline";

// Spec step 187 against a real Postgres: every action Jane takes by herself is written when
// she takes it (recordAct), and every one appears on the timeline with its reason; nothing
// of another person's does.

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("everything Jane did, against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const person = async (prefix: string) => {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  };
  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("lists every autopilot action with its reason and money, newest first, only mine", async () => {
    const userId = await person("timeline-mine");
    const other = await person("timeline-other");
    for (const [i, sector] of SECTORS.entries()) {
      await recordAct(userId, sector, 1_000 * (i + 1), `Did ${sector} thing`, {
        client,
        now: new Date(Date.UTC(2026, 9, 10 + i)),
      });
    }
    await recordAct(other, "bills", 500, "Someone else's", { client });

    const timeline = await loadTimeline(userId, { client });
    expect(timeline).toHaveLength(SECTORS.length);
    expect(timeline.map((e) => e.what)).toEqual(
      [...SECTORS].reverse().map((s) => `Did ${s} thing`),
    );
    expect(timeline.every((e) => e.by === "jane" && e.why.length > 0)).toBe(true);
    expect(timeline[0]).toMatchObject({ cents: 6_000, sector: "goals" });
    // Nothing missing against the record Jane keeps of her own acts.
    expect(await client.autopilotAct.count({ where: { userId } })).toBe(timeline.length);
  });

  it("includes what the person tapped, with undo while it's pending", async () => {
    const userId = await person("timeline-transfer");
    const account = await client.account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository", subtype: "checking" },
    });
    await client.moneyTransfer.create({
      data: {
        userId,
        fromAccountId: account.id,
        toName: "Emergency fund",
        amountCents: 3_400,
        purpose: "goal",
        sector: "goals",
        runOn: new Date("2026-10-25T00:00:00Z"),
        partner: "stand-in",
        by: "person",
      },
    });
    const [entry] = await loadTimeline(userId, { client });
    expect(entry).toMatchObject({
      by: "you",
      what: "Moved $34.00 to Emergency fund",
      undoHref: "/transfers",
    });
  });
});

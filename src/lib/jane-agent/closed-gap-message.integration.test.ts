import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { putAwayUntrue } from "./still-true";
import { loadPopupStack } from "./popup-stack";

// "No renters insurance on file" stayed in the dock after the person added their policy, or a
// later file showed them paying for one: nothing checked it again.
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("a coverage gap's card", () => {
  let client: PrismaClient;
  let userId: string;
  let messageId: string;
  const now = new Date();

  const cards = async () => (await loadPopupStack(userId, { client, now })).map((m) => m.id);

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `closed-gap-${crypto.randomUUID()}@example.com` } })
    ).id;
    await client.insuranceProfile.create({ data: { userId, housing: "rent" } });
    messageId = (
      await client.janeMessage.create({
        data: {
          userId,
          kind: "heads_up",
          body: "No renters insurance on file. You told me you rent.",
          refs: { insuranceGap: "renters" },
          actions: [
            { id: "open", label: "I have renters insurance", kind: "link", href: "/insurance" },
            { id: "insurance.gap_no", label: "I don't need it", kind: "secondary" },
            { id: "snooze", label: "Not now", kind: "secondary" },
          ],
          dedupeKey: `gap:renters:${crypto.randomUUID()}`,
          createdAt: now,
        },
      })
    ).id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("stays while the gap is open", async () => {
    expect(await cards()).toContain(messageId);
    expect(await putAwayUntrue(userId, { client, now })).toBe(0);
    expect((await client.janeMessage.findUniqueOrThrow({ where: { id: messageId } })).status).toBe(
      "open",
    );
  });

  it("goes once the same cover is seen in the payments, and closes", async () => {
    const policy = await client.insurancePolicy.create({
      data: { userId, kind: "renters", carrier: "Lemonade", source: "payments", status: "found" },
    });
    expect(await cards()).not.toContain(messageId);
    const closed = await client.janeMessage.findUniqueOrThrow({ where: { id: messageId } });
    expect(closed.status).toBe("answered");
    await client.insurancePolicy.delete({ where: { id: policy.id } });
  });
});

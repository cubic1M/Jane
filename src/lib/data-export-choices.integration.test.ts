import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { exportUserData } from "./data-export";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("the download: saved choices and other people's ids", () => {
  let client: PrismaClient;
  const people: string[] = [];
  const person = async () => {
    const { id } = await client.user.create({
      data: { email: `choices-${crypto.randomUUID()}@example.com` },
    });
    people.push(id);
    return id;
  };

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.auditLog.deleteMany({ where: { actorId: { in: people } } });
    await client.user.deleteMany({ where: { id: { in: people } } });
    await client.$disconnect();
  });

  it("holds the receipts they ticked and the record years they were reminded of", async () => {
    const userId = await person();
    await client.taxProfile.create({
      data: { userId, givingReceipts: ["gift-ticked"], retentionReminded: ["2019-reminded"] },
    });
    const all = JSON.stringify(await exportUserData(userId, { client }));
    expect(all).toContain("gift-ticked");
    expect(all).toContain("2019-reminded");
  });

  // A team member's own download lists what they did, not whose accounts it was done to.
  it("leaves another person's id out of what a team member did", async () => {
    const [staff, customer] = [await person(), await person()];
    await client.auditLog.create({
      data: {
        actorType: "admin",
        actorId: staff,
        event: "invite_code_emailed",
        metadata: { user_id: customer, note: "kept" },
      },
    });
    const all = JSON.stringify(await exportUserData(staff, { client }));
    expect(all).toContain('"note":"kept"');
    expect(all).not.toContain(customer);
  });
});

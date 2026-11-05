import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { exportUserData } from "./data-export";

// A read of every promise against the code: /privacy and the Terms say the download holds your data,
// but the activity log, the sign-in records and what each analytics event carried weren't in it.
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("the download", () => {
  let client: PrismaClient;
  const people: string[] = [];
  const person = async () => {
    const { id } = await client.user.create({
      data: { email: `records-${crypto.randomUUID()}@example.com` },
    });
    people.push(id);
    await client.activityEvent.create({
      data: { userId: id, visitId: "v1", kind: "page_view", path: `/seen-by-${id}` },
    });
    await client.auditLog.create({
      data: {
        actorType: "user",
        actorId: id,
        event: "signed_in",
        metadata: { ip: "198.51.100.8", who: id },
      },
    });
    await client.analyticsEvent.create({
      data: { userId: id, name: "opened", properties: { who: id } },
    });
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

  it("holds their activity log and their records, and nobody else's", async () => {
    const [mine, other] = [await person(), await person()];
    const all = JSON.stringify(await exportUserData(mine, { client }));
    expect(all).toContain(`/seen-by-${mine}`);
    expect(all).toContain("198.51.100.8");
    expect(all).toContain(`"who":"${mine}"`);
    expect(all).not.toContain(other);
  });
});

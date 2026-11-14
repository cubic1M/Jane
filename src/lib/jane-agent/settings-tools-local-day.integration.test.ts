import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { runChatTool } from "./claude-tools";

// Debugger 11-14: a student imported their Chase file at 10:40pm in Los Angeles (06:40 UTC the
// next day). Settings said "Last import Nov 14", and the chat's connections tool said
// "2026-11-14": both read the moment in UTC. It's the person's own day, US Pacific when they
// haven't set a timezone.

const url = process.env.TEST_DATABASE_URL;
const IMPORTED = new Date("2026-11-14T06:40:44Z");

describe.runIf(url)("the chat's connections tool", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({
        data: { email: `settings-local-day-${crypto.randomUUID()}@example.com` },
      })
    ).id;
    const account = await client.account.create({
      data: { userId, source: "csv", name: "Chase checking", type: "depository" },
    });
    await client.$executeRaw`UPDATE accounts SET updated_at = ${IMPORTED} WHERE id = ${account.id}`;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  const lastImport = async () =>
    JSON.parse(
      (
        await runChatTool(
          userId,
          "connections",
          {},
          { client, now: new Date("2026-11-14T08:00:00Z") },
        )
      ).content,
    ).csvImports[0].lastImport;

  it("says a file's last import as the person's own day", async () => {
    expect(await lastImport()).toBe("2026-11-13");
  });

  it("and in their timezone once they've set one", async () => {
    await client.user.update({ where: { id: userId }, data: { timezone: "Asia/Tokyo" } });
    expect(await lastImport()).toBe("2026-11-14");
  });
});

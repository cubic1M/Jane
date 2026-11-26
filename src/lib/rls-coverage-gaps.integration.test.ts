import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { loginCheck, rlsCoverage } from "./rls-coverage";

// Two gaps the health check read as healthy, tried on a real database inside transactions that are
// undone, so no other test sees the policy or the role.
const url = process.env.TEST_DATABASE_URL;

class Undo extends Error {}

describe.runIf(url)("row-level security gaps the health check must see", () => {
  let client: PrismaClient;

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(() => client.$disconnect());

  it("a person's policy that no longer applies to jane_rls", async () => {
    let missing: string[] = [];
    await expect(
      client.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("ALTER POLICY jane_rls_owner ON accounts TO CURRENT_USER");
        missing = (await rlsCoverage({ client: tx })).missing;
        throw new Undo();
      }),
    ).rejects.toBeInstanceOf(Undo);
    expect(missing).toEqual(["accounts"]);
  });

  it.each([
    ["nothing", null, true],
    ["one column of one table", "GRANT SELECT (email) ON users TO", false],
    ["adding rows only", "GRANT INSERT ON users TO", false],
    ["another table", "GRANT SELECT ON accounts TO", false],
  ])("a login that can use %s", async (_what, grant, denied) => {
    const role = `login_probe_${crypto.randomUUID().slice(0, 8)}`;
    let seen: Awaited<ReturnType<typeof loginCheck>> | undefined;
    await expect(
      client.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`CREATE ROLE "${role}" NOLOGIN`);
        await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO "${role}"`);
        if (grant) await tx.$executeRawUnsafe(`${grant} "${role}"`);
        await tx.$executeRawUnsafe(`SET LOCAL ROLE "${role}"`);
        seen = await loginCheck({ client: tx as unknown as PrismaClient });
        throw new Undo();
      }),
    ).rejects.toBeInstanceOf(Undo);
    expect(seen).toEqual({ login: role, denied });
  });
});

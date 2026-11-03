import { vi } from "vitest";

// With TEST_NO_BYPASS=1 (src/test-setup/no-bypass-global.ts) the whole suite runs on a login role
// that can't touch a table itself, as production does once it has jane_app: see no-bypass-client.ts.
vi.mock("@/generated/prisma/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/generated/prisma/client")>();
  if (process.env.TEST_NO_BYPASS !== "1") return real;
  const { fixtureClient } = await import("./no-bypass-client");
  return { ...real, PrismaClient: fixtureClient(real.PrismaClient) };
});

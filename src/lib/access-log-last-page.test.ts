import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { ACCESS_LOG_PAGE_SIZE } from "@/config/access-log";

const findMany = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/system-db", () => ({ systemDb: () => ({ auditLog: { findMany } }) }));

import { parseFilters, searchAccessLog } from "./access-log";

describe("the access log's last reachable page", () => {
  it("offers no next page that would only show itself again", async () => {
    findMany.mockResolvedValue(
      Array.from({ length: ACCESS_LOG_PAGE_SIZE + 1 }, (_, i) => ({
        id: `a${i}`,
        createdAt: new Date(),
        event: "signed_in",
        actorType: "user",
        actorId: "u1",
        targetType: null,
        targetId: null,
        metadata: {},
      })),
    );
    const client = {} as PrismaClient;
    const last = parseFilters({ page: "5000" });
    expect((await searchAccessLog(last, { client })).more).toBe(false);
    const earlier = parseFilters({ page: "2" });
    expect((await searchAccessLog(earlier, { client })).more).toBe(true);
  });
});

import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";

const table = vi.hoisted(() => ({ createMany: vi.fn(), deleteMany: vi.fn() }));
vi.mock("@/lib/system-db", () => ({ systemDb: () => ({ plaidWebhookEvent: table }) }));

import { firstDelivery } from "./webhooks";

describe("a delivery whose old records can't be cleared", () => {
  // The record was already written: throwing here made Plaid's retry look like a repeat.
  it("is still the first, so it is acted on", async () => {
    table.createMany.mockResolvedValue({ count: 1 });
    table.deleteMany
      .mockResolvedValueOnce({ count: 0 })
      .mockRejectedValueOnce(new Error("database down"));
    await expect(
      firstDelivery("{}", { webhook_type: "ITEM" }, { client: {} as PrismaClient }),
    ).resolves.toBe(true);
  });
});

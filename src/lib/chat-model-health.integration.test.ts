import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => undefined) }));

import { chatModelLine } from "./chat-model-health";
import { recordOpsEvent } from "./ops-alerts";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2027-03-01T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

// /admin/health's red line: the chat couldn't reach Claude.
describe.runIf(url)("the chat model's red line", () => {
  let client: PrismaClient;
  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  beforeEach(async () => {
    await client.opsEvent.deleteMany({
      where: { createdAt: { gte: hoursAgo(48), lte: NOW } },
    });
  });
  afterAll(async () => {
    await client.opsEvent.deleteMany({
      where: { createdAt: { gte: hoursAgo(48), lte: NOW } },
    });
    await client.$disconnect();
  });

  it("is nothing when the chat has been reaching Claude", async () => {
    await recordOpsEvent("plaid_sync_failed", { client, now: hoursAgo(1) });
    expect(await chatModelLine({ client, now: NOW })).toBeNull();
  });

  it("counts the last day's refused and failed calls and dates the first", async () => {
    await recordOpsEvent("claude_key_refused", { code: "HTTP_401", client, now: hoursAgo(30) });
    await recordOpsEvent("claude_key_refused", { code: "HTTP_401", client, now: hoursAgo(5) });
    await recordOpsEvent("chat_model_unavailable", {
      code: "KEY_REFUSED",
      client,
      now: hoursAgo(2),
    });
    expect(await chatModelLine({ client, now: NOW })).toBe(
      "Chat model unavailable: 1 refused or failed call since 2027-03-01 07:00 UTC",
    );
  });

  it("counts the refused calls alone when only background work met the refusal", async () => {
    await recordOpsEvent("claude_key_refused", { code: "HTTP_401", client, now: hoursAgo(5) });
    await recordOpsEvent("claude_key_refused", { code: "HTTP_401", client, now: hoursAgo(4) });
    expect(await chatModelLine({ client, now: NOW })).toBe(
      "Chat model unavailable: 2 refused or failed calls since 2027-03-01 07:00 UTC",
    );
  });
});

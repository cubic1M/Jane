import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

const hooks = vi.hoisted(() => ({
  primer: vi.fn(async () => {}),
  close: vi.fn(async () => 0),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
vi.mock("../primer-store", async (original) => ({
  ...(await original<typeof import("../primer-store")>()),
  markPrimerStale: (...args: unknown[]) =>
    (hooks.primer as (...a: unknown[]) => Promise<void>)(...args),
}));
vi.mock("../messages", async (original) => ({
  ...(await original<typeof import("../messages")>()),
  closeSettled: (...args: unknown[]) =>
    (hooks.close as (...a: unknown[]) => Promise<number>)(...args),
}));

import { logAudit } from "@/lib/audit";
import { takeChatAction } from ".";

// What a tap does when the work around it fails or the message changes under it (CodeRabbit
// sweep part 2, chunk act-02), against a real Postgres. multi.cancel is a button with no effect
// of its own, so what is checked is the dispatcher.

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("a tap's work around the handler", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  let userId: string;

  const openMessage = () =>
    client.janeMessage.create({
      data: {
        userId,
        kind: "reply",
        dedupeKey: `tap-${crypto.randomUUID()}`,
        body: "The plan.",
        status: "open",
        actions: [{ id: "multi.cancel", label: "Cancel", kind: "secondary" }],
        refs: {},
      },
    });

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    userId = (
      await client.user.create({ data: { email: `take-${crypto.randomUUID()}@example.com` } })
    ).id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });
  beforeEach(() => {
    hooks.primer.mockReset().mockResolvedValue(undefined);
    hooks.close.mockReset().mockResolvedValue(0);
    vi.mocked(logAudit).mockClear();
  });

  it("still answers the message when marking Claude's numbers stale fails", async () => {
    const message = await openMessage();
    hooks.primer.mockRejectedValueOnce(new Error("snapshot busy"));
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    await takeChatAction(userId, message.id, "multi.cancel", { client });
    expect((await client.janeMessage.findUniqueOrThrow({ where: { id: message.id } })).status).toBe(
      "answered",
    );
  });

  it("writes the audit row even when closing the other messages fails", async () => {
    const message = await openMessage();
    hooks.close.mockRejectedValueOnce(new Error("cleanup failed"));
    await takeChatAction(userId, message.id, "multi.cancel", { client }).catch(() => {});
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      expect.anything(),
      "chat_action_taken",
      expect.objectContaining({ id: message.id }),
      expect.anything(),
    );
  });

  it("does not write an old outcome over a message that was refreshed meanwhile", async () => {
    const message = await openMessage();
    // The message is brought back as it is now (same status, new words, new time) mid-tap.
    hooks.primer.mockImplementationOnce(async () => {
      await client.janeMessage.update({
        where: { id: message.id },
        data: { body: "A refreshed plan.", createdAt: new Date(Date.now() + 5_000) },
      });
    });
    await takeChatAction(userId, message.id, "multi.cancel", { client });
    const row = await client.janeMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(row.body).toBe("A refreshed plan.");
    expect(row.status).toBe("open");
    expect(row.answeredWith).toBeNull();
  });
});

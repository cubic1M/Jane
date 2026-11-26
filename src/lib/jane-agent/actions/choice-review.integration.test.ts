import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { logAudit } from "@/lib/audit";
import { autopilotOf, setAutopilot } from "@/lib/autopilot";
import { takeChatAction } from ".";

// The autopilot question's buttons and Revert (CodeRabbit sweep part 2, chunk act-02), against a
// real Postgres: a Revert never covers a later change, and a failed write after the level was
// saved still gives the card its Revert.

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("autopilot choice and Revert", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function person() {
    const user = await client.user.create({
      data: { email: `choice-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  }
  const question = (userId: string) =>
    client.janeMessage.create({
      data: {
        userId,
        kind: "decision",
        dedupeKey: `autopilot-${crypto.randomUUID()}`,
        body: "How much should I do on my own?",
        status: "open",
        actions: [
          { id: "autopilot.safe", label: "Safe stuff", kind: "primary" },
          { id: "autopilot.all", label: "Everything allowed", kind: "secondary" },
          { id: "autopilot.ask", label: "Ask me first", kind: "secondary" },
        ],
        refs: {},
      },
    });

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("does not put an old level back over a later pause", async () => {
    const userId = await person();
    const message = await question(userId);
    await takeChatAction(userId, message.id, "autopilot.all", { client });
    expect(await autopilotOf(userId, { client })).toBe("all");
    await setAutopilot(userId, "ask", { client });
    await expect(
      takeChatAction(userId, message.id, "choice.revert", { client }),
    ).rejects.toMatchObject({ code: "expired" });
    expect(await autopilotOf(userId, { client })).toBe("ask");
  });

  it("still reverts when nothing changed after the choice", async () => {
    const userId = await person();
    const message = await question(userId);
    await takeChatAction(userId, message.id, "autopilot.all", { client });
    await takeChatAction(userId, message.id, "choice.revert", { client });
    expect(await autopilotOf(userId, { client })).toBeNull();
  });

  it("keeps the choice and its Revert when a write after the level was saved fails", async () => {
    const userId = await person();
    const message = await question(userId);
    vi.mocked(logAudit).mockImplementation(async (_actor, action) => {
      if (action === "autopilot_set") throw new Error("audit down");
    });
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    const { message: answered } = await takeChatAction(userId, message.id, "autopilot.safe", {
      client,
    });
    vi.mocked(logAudit).mockReset();
    expect(await autopilotOf(userId, { client })).toBe("safe");
    expect(answered.refs.chosen?.actionId).toBe("autopilot.safe");
    expect(answered.actions.map((a) => a.id)).toContain("choice.revert");
  });
});

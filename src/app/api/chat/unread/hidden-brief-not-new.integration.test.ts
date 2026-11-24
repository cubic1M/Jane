import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

// Debugger 11-18 (r342, Plaid S5 on a phone): the chat button said "Chat with Jane, 1 new", and
// the chat opened on "Nothing new from me yet". The one was the morning greeting, which is written
// but shows nowhere while the brief is off. The dot counts only what the chat can show.

const url = process.env.TEST_DATABASE_URL;
const who = vi.hoisted(() => ({ id: "", client: null as unknown }));
vi.mock("@/lib/session", () => ({ getCurrentUser: async () => ({ id: who.id }) }));
// The route reads through the app's own client: here, the test database's.
vi.mock("@/lib/db", () => ({
  get db() {
    return who.client;
  },
}));

import { MORNING_BRIEF } from "@/config/agent-chat";
import { GET } from "./route";

describe.runIf(url && !MORNING_BRIEF)("the chat's unread dot", () => {
  let client: PrismaClient;
  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    who.client = client;
    const user = await client.user.create({
      data: { email: `hidden-brief-not-new-${crypto.randomUUID()}@example.com` },
    });
    who.id = user.id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: who.id } });
    await client.$disconnect();
  });

  const count = async () => ((await (await GET()).json()) as { unread: number }).unread;

  it("leaves out the morning greeting the chat doesn't show", async () => {
    await client.janeMessage.create({
      data: {
        userId: who.id,
        kind: "brief",
        dedupeKey: "brief:2026-11-18",
        body: "Good morning! You have $860.00 safe to spend this month.",
      },
    });
    expect(await count()).toBe(0);
  });

  // Founder 11-24: Jane's unasked cards (a heads-up here) wait in the dock, which counts them; the
  // chat doesn't hold them, so the dot never calls one "new" there (src/lib/jane-agent/popups.ts).
  it("leaves out a heads-up, which waits in the dock and not in the chat", async () => {
    await client.janeMessage.create({
      data: {
        userId: who.id,
        kind: "heads_up",
        dedupeKey: "heads_up:hulu",
        body: "Your Hulu renews tomorrow: $9.99.",
      },
    });
    expect(await count()).toBe(0);
  });

  it("still counts an answer in the chat not yet seen", async () => {
    await client.janeMessage.create({
      data: {
        userId: who.id,
        kind: "reply",
        dedupeKey: `reply:${crypto.randomUUID()}`,
        body: "Your Hulu is $9.99 a month.",
      },
    });
    expect(await count()).toBe(1);
  });
});

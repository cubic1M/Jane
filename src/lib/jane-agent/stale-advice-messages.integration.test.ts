import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { loadPopupStack } from "./popup-stack";
import { closeAnsweredElsewhere } from "./settled";
import { parseActions } from "./types";

// Someone tried the demo bank, then added a real account. The scan deletes the advice suggestion,
// and a message with no suggestion row never closed, so Home went on offering "Drop your mortgage
// insurance, save $1,562/yr", with Yes and no demo label.
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("an advice message once a real account joins", () => {
  let client: PrismaClient;
  let userId: string;
  let messageId: string;
  const now = new Date();

  const card = async () => (await loadPopupStack(userId, { client, now })).map((m) => m.id);
  const status = async () => client.janeMessage.findUniqueOrThrow({ where: { id: messageId } });

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({
        data: { email: `stale-message-${crypto.randomUUID()}@example.com` },
      })
    ).id;
    await client.plaidItem.create({
      data: {
        userId,
        plaidItemId: `demo-${crypto.randomUUID()}`,
        accessTokenEncrypted: "v1:unused",
      },
    });
    messageId = (
      await client.janeMessage.create({
        data: {
          userId,
          kind: "decision",
          body: "Drop your mortgage insurance, save $1,562/yr",
          refs: { advice: true, suggestion: "debt:pmi_removal" },
          actions: [
            { id: "suggestion.yes", label: "Yes", kind: "primary" },
            { id: "snooze", label: "Not now", kind: "secondary" },
            { id: "open", label: "Open", kind: "link", href: "/loans" },
          ],
          dedupeKey: `debt:pmi_removal:${crypto.randomUUID()}`,
          createdAt: now,
        },
      })
    ).id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("stays while the demo bank is all there is", async () => {
    expect(await card()).toContain(messageId);
    expect(await closeAnsweredElsewhere(userId, { client })).toBe(0);
    expect((await status()).status).toBe("open");
  });

  it("leaves the cards at once and closes with its link kept when a real file is added", async () => {
    await client.account.create({
      data: {
        userId,
        name: "Everyday Checking",
        source: "csv",
        plaidAccountId: null,
        type: "depository",
      },
    });
    expect(await card()).not.toContain(messageId);
    expect(await closeAnsweredElsewhere(userId, { client })).toBe(1);
    const closed = await status();
    expect(closed.status).toBe("answered");
    expect(parseActions(closed.actions).map((a) => a.id)).toEqual(["open"]);
  });
});

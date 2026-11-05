import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { noticeDraftMessage } from "@/lib/jane-agent/tax-notice-message";
import { sendResponse } from "./index";

// A read of every chat button: on a real IRS letter, "Have Jane's team send it" said "Jane's team
// has it and will send it", though nothing reaches a team and there's none for a real account. The
// reminders then stopped, so nobody replied and the person believed it was done.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-04T15:00:00Z");

describe.runIf(url)("a real person's reply to a tax notice", () => {
  let client: PrismaClient;
  let userId: string;
  let noticeId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    ({ id: userId } = await client.user.create({
      data: { email: `no-team-${crypto.randomUUID()}@example.com` },
    }));
    await client.account.create({
      data: { userId, source: "csv", name: "Real checking", type: "depository" },
    });
    const { id: documentId } = await client.document.create({
      data: {
        userId,
        kind: "tax_notice",
        fileName: "notice.pdf",
        contentType: "application/pdf",
        sizeBytes: 1,
        encryptedBytes: Buffer.from("x"),
        uploadedAt: NOW,
      },
    });
    ({ id: noticeId } = await client.taxNotice.create({
      data: {
        userId,
        documentId,
        status: "confirmed",
        fields: { kind: "CP2000", dueOn: "2026-12-01" },
        sources: {},
        notes: {},
        response: "agree",
        draft: "I agree.",
      },
    }));
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("can't be handed to a team that isn't there, so its reminders go on", async () => {
    await expect(sendResponse(userId, noticeId, "team", { client, now: NOW })).rejects.toThrow(
      /send this one yourself/,
    );
    const row = await client.taxNotice.findUniqueOrThrow({ where: { id: noticeId } });
    expect(row.handledBy).toBeNull();
  });

  it("can be sent by the person themselves", async () => {
    await sendResponse(userId, noticeId, "you", { client, now: NOW });
    const row = await client.taxNotice.findUniqueOrThrow({ where: { id: noticeId } });
    expect(row.handledBy).toBe("you");
  });

  it("offers only that, in the chat", () => {
    const view = { id: "n", kind: "CP2000", draft: "I agree." } as never;
    const real = noticeDraftMessage(view, false);
    expect(real.actions?.map((a) => a.id)).not.toContain("tax.notice_team");
    expect(real.body).not.toMatch(/team/i);
    expect(noticeDraftMessage(view, true).actions?.map((a) => a.id)).toContain("tax.notice_team");
  });
});

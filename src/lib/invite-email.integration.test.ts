import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { emailInvite, renderInviteEmail } from "./invite-email";
import { generateCode } from "./invites";

// A founder emails a student their invite from /admin/invites: only to the one address the code is
// locked to, only while it works, with the sign-up link and the code and never the team's note.
const url = process.env.TEST_DATABASE_URL;

type Sent = { to: string; subject: string; text: string; html: string; replyTo?: string };

describe.runIf(url)("emailing an invite", () => {
  let client: PrismaClient;
  const send = vi.fn(async (_email: Sent) => undefined);
  const made: string[] = [];
  const code = async (data: Record<string, unknown> = {}) => {
    const row = await client.inviteCode.create({
      data: { code: generateCode(), maxUses: 1, note: "Sam's roommate", ...data },
    });
    made.push(row.id);
    return row.code;
  };

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    vi.stubEnv("APP_URL", "https://jane.example");
  });
  beforeEach(() => send.mockClear());
  afterAll(async () => {
    await client.inviteCode.deleteMany({ where: { id: { in: made } } });
    vi.unstubAllEnvs();
    await client.$disconnect();
  });

  it("sends the link and the code to the locked address, and records when", async () => {
    const now = new Date("2026-11-12T10:00:00Z");
    const c = await code({ email: "student@example.edu" });
    expect(
      await emailInvite(c, { client, now, send, replyTo: "founder@example.test" }),
    ).toMatchObject({ result: "sent" });
    const [mail] = send.mock.calls.map(([m]) => m);
    expect(mail.to).toBe("student@example.edu");
    expect(mail.replyTo).toBe("founder@example.test");
    expect(mail.text).toContain(`https://jane.example/signup?invite=${c}`);
    expect(mail.text).toContain(c);
    expect(mail.text + mail.html).not.toContain("roommate");
    expect((await client.inviteCode.findUniqueOrThrow({ where: { code: c } })).emailedAt).toEqual(
      now,
    );
  });

  it("never emails a code for anyone, or one that no longer works", async () => {
    expect((await emailInvite(await code(), { client, send })).result).toBe("not_locked");
    const off = await code({ email: "a@example.edu", revokedAt: new Date() });
    expect((await emailInvite(off, { client, send })).result).toBe("not_active");
    const full = await code({ email: "b@example.edu", uses: 1 });
    expect((await emailInvite(full, { client, send })).result).toBe("not_active");
    expect((await emailInvite("ZZZZ-ZZZZ-ZZZZ", { client, send })).result).toBe("not_found");
    expect(send).not.toHaveBeenCalled();
  });

  it("says when the email didn't go, and doesn't mark it sent", async () => {
    const c = await code({ email: "c@example.edu" });
    send.mockRejectedValueOnce(new Error("Resend rejected the email (500)"));
    expect((await emailInvite(c, { client, send })).result).toBe("failed");
    expect(
      (await client.inviteCode.findUniqueOrThrow({ where: { code: c } })).emailedAt,
    ).toBeNull();
  });

  it("says when the code stops working", () => {
    const now = new Date("2026-11-12T10:00:00Z");
    const text = (at: string) => renderInviteEmail("ABCD-EFGH-JKMN", new Date(at), now).text;
    expect(text("2026-11-26T10:00:00Z")).toContain("It works for 14 more days.");
    expect(text("2026-11-12T20:00:00Z")).toContain("It works for 1 more day.");
    expect(renderInviteEmail("ABCD-EFGH-JKMN", null, now).text).not.toContain("It works for");
  });
});

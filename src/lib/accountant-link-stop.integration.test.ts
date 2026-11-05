import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { isHiddenPage } from "@/config/hidden-pages";
import { logAudit } from "@/lib/audit";
import { answersMessage } from "@/lib/jane-agent/accountant-message";
import { createAccountantLink, revokeAllAccountantLinks, viewByToken } from "./accountant";

// A read of who can give whom access: a link could only be stopped on /taxes/accountant, which is
// hidden, so whoever held one could go on reading payee names until it expired, and write to the
// person as "your accountant", in a name they typed themselves.
const url = process.env.TEST_DATABASE_URL;

describe("taking back an accountant's link", () => {
  it("is on a page people can reach", () => {
    expect(isHiddenPage("/taxes/accountant")).toBe(true);
    expect(isHiddenPage("/settings")).toBe(false);
    expect(readFileSync("src/app/settings/page.tsx", "utf8")).toContain("<AccountantLinksForm");
  });

  it("doesn't call what a link's holder typed the person's accountant", () => {
    const message = answersMessage({
      year: 2026,
      notes: [{ seen: false, fromName: "IRS Agent", body: "Pay here", questionText: null }],
    } as never);
    expect(message?.body).not.toMatch(/your accountant wrote/i);
    expect(message?.body).toContain("Signed IRS Agent");
  });
});

describe.runIf(url)("stopping every link", () => {
  let client: PrismaClient;
  let userId: string;
  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    ({ id: userId } = await client.user.create({
      data: { email: `stop-${crypto.randomUUID()}@example.com` },
    }));
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("ends them all, and each is on the audit log", async () => {
    const first = await createAccountantLink(userId, { label: "Dana", days: 7 }, { client });
    const second = await createAccountantLink(userId, { label: "Lee", days: 7 }, { client });
    const token = (u: string) => u.split("/").pop() as string;
    expect(await viewByToken(token(first.url), { client })).not.toMatchObject({
      state: "unavailable",
    });
    expect(await revokeAllAccountantLinks(userId, { client })).toBe(2);
    expect(await viewByToken(token(first.url), { client })).toMatchObject({
      state: "unavailable",
    });
    expect(await viewByToken(token(second.url), { client })).toMatchObject({
      state: "unavailable",
    });
    expect(await revokeAllAccountantLinks(userId, { client })).toBe(0);
    const logged = vi
      .mocked(logAudit)
      .mock.calls.filter(([, e]) => e === "accountant_link_revoked");
    expect(logged).toHaveLength(2);
  });
});

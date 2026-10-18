import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { track } from "@/lib/analytics";
import { findingOfType } from "../__fixtures__/findings";
import { runDigests } from "./send";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
// Other tests share the database, so assertions look only at this file's users.
const url = process.env.TEST_DATABASE_URL;
// A Monday afternoon in California.
const MONDAY = new Date("2026-10-19T22:00:00Z");

describe.runIf(url)("runDigests against a real database", () => {
  let client: PrismaClient;
  const suffix = crypto.randomUUID();
  const ids: Record<string, string> = {};
  const send = vi.fn();

  async function person(
    name: string,
    opts: { account?: boolean; finding?: boolean; digest?: boolean } = {},
  ) {
    const user = await client.user.create({
      data: { email: `${name}-${suffix}@example.com`, digestEnabled: opts.digest ?? true },
    });
    ids[name] = user.id;
    if (opts.account ?? true) {
      await client.account.create({
        data: {
          userId: user.id,
          source: "csv",
          name: "Card",
          type: "credit",
          subtype: "credit card",
        },
      });
    }
    if (opts.finding) {
      const f = findingOfType("bank_fees");
      await client.finding.create({
        data: {
          userId: user.id,
          type: f.type,
          key: f.key,
          title: f.title,
          annualSavingsCents: f.annualSavingsCents,
          amountCents: f.amountCents,
          confidence: f.confidence,
          evidence: f.evidence as Prisma.InputJsonObject,
          createdAt: new Date("2026-10-17T00:00:00Z"),
        },
      });
    }
  }

  beforeAll(async () => {
    vi.stubEnv("AUTH_SECRET", "test-secret");
    vi.stubEnv("APP_URL", "https://app.example.com");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    await person("news", { finding: true });
    await person("quiet");
    await person("optedout", { finding: true, digest: false });
    await person("unlinked", { account: false });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    send.mockReset();
    vi.mocked(track).mockReset();
  });

  const digestsOf = (name: string) => client.digest.findMany({ where: { userId: ids[name] } });
  const sentTo = () => send.mock.calls.map(([mail]) => mail.to as string);

  it("dry run renders digests for everyone due without sending or storing", async () => {
    const run = await runDigests({ client, now: MONDAY, dryRun: true, send });

    const preview = run.previews.find((p) => p.userId === ids.news);
    expect(preview?.text).toContain("New since last week");
    expect(run.previews.some((p) => p.userId === ids.quiet)).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(await digestsOf("news")).toEqual([]);
  });

  it("sends once per week, only to active people with something to say", async () => {
    await runDigests({ client, now: MONDAY, send });

    expect(sentTo().filter((to) => to.includes(suffix))).toEqual([`news-${suffix}@example.com`]);
    const mail = send.mock.calls.find(([m]) => m.to.includes("news-"))?.[0];
    expect(mail.headers["List-Unsubscribe"]).toMatch(
      /^<https:\/\/app\.example\.com\/api\/unsubscribe\?token=/,
    );
    expect(mail.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(mail.html).toContain("https://app.example.com/api/digest/click?d=");
    const [digest] = await digestsOf("news");
    expect(digest.sentAt).toEqual(MONDAY);
    expect(digest.weekStart.toISOString().slice(0, 10)).toBe("2026-10-19");
    expect(track).toHaveBeenCalledWith(ids.news, "digest_sent", expect.any(Object));

    send.mockReset();
    await runDigests({ client, now: new Date("2026-10-20T22:00:00Z"), send });
    expect(sentTo().filter((to) => to.includes(suffix))).toEqual([]);
  });

  it("keeps nothing when sending fails, so the next run retries", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const nextMonday = new Date("2026-10-26T22:00:00Z");
    await client.finding.updateMany({
      where: { userId: ids.news },
      data: { createdAt: new Date("2026-10-24T00:00:00Z") },
    });
    send.mockRejectedValue(new Error("Resend down"));

    await runDigests({ client, now: nextMonday, send });

    expect((await digestsOf("news")).map((d) => d.weekStart.toISOString().slice(0, 10))).toEqual([
      "2026-10-19",
    ]);
  });
});

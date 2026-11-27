import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { latestDraftCheck } from "./index";

// CodeRabbit sweep: the check the detectors and the chat use is the one confirmed last, not the
// one uploaded last.
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("the latest checked draft return", () => {
  let client: PrismaClient;
  let userId: string;

  const draft = async (year: number, createdAt: string, confirmedAt: string) => {
    const { id: documentId } = await client.document.create({
      data: {
        userId,
        kind: "draft_return",
        fileName: `draft-${year}.pdf`,
        contentType: "application/pdf",
        sizeBytes: 1,
        encryptedBytes: Buffer.from("x"),
        uploadedAt: new Date(createdAt),
      },
    });
    return client.draftReturn.create({
      data: {
        userId,
        documentId,
        status: "confirmed",
        fields: { taxYear: String(year) },
        sources: {},
        notes: {},
        findings: [],
        createdAt: new Date(createdAt),
        confirmedAt: new Date(confirmedAt),
      },
    });
  };

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    ({ id: userId } = await client.user.create({
      data: { email: `latest-draft-${crypto.randomUUID()}@example.com` },
    }));
  });
  afterAll(async () => {
    // Never with an unset id: Prisma would drop the filter and delete every person.
    try {
      if (userId) await client.user.deleteMany({ where: { id: userId } });
    } finally {
      await client.$disconnect();
    }
  });

  it("picks the draft confirmed last, even when another was uploaded after it", async () => {
    // 2024 is uploaded first and confirmed after 2025.
    await draft(2025, "2026-10-02T10:00:00Z", "2026-10-03T10:00:00Z");
    const first = await draft(2024, "2026-10-01T10:00:00Z", "2026-10-05T10:00:00Z");
    const latest = await latestDraftCheck(userId, { client });
    expect(latest).toMatchObject({ id: first.id, year: 2024 });
  });
});

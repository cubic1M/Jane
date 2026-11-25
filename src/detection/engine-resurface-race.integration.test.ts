import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { scopedFor } from "@/lib/db-scoped";
import { writeFindingUpdate } from "./engine";
import type { Candidate } from "./types";

// CodeRabbit 1c detn-01 #10: a scan that planned to resurface a declined finding set it back to
// "new" even when the person had approved it since the scan read it.
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("writing a planned resurface", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    ({ id: userId } = await client.user.create({
      data: { email: `resurface-${crypto.randomUUID()}@example.com` },
    }));
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  const finding = (status: "declined" | "approved") =>
    client.finding.create({
      data: {
        userId,
        type: "bank_fees",
        key: `account:${crypto.randomUUID()}`,
        title: "old",
        annualSavingsCents: 3_400,
        amountCents: 3_400,
        confidence: "high",
        evidence: {},
        status,
      },
    });
  const bigger = (key: string): Candidate => ({
    type: "bank_fees",
    key,
    title: "new",
    annualSavingsCents: 9_000,
    amountCents: 9_000,
    confidence: "high",
    evidence: {},
  });

  it("brings a still-declined finding back as new", async () => {
    const row = await finding("declined");
    const db = scopedFor(userId, client);
    const wrote = await writeFindingUpdate(db, {
      id: row.id,
      candidate: bigger(row.key),
      resurface: true,
    });
    expect(wrote).toBe(true);
    expect(await client.finding.findUnique({ where: { id: row.id } })).toMatchObject({
      status: "new",
      amountCents: 9_000,
    });
  });

  it("leaves a finding the person approved since the scan read it", async () => {
    const row = await finding("approved");
    const db = scopedFor(userId, client);
    const wrote = await writeFindingUpdate(db, {
      id: row.id,
      candidate: bigger(row.key),
      resurface: true,
    });
    expect(wrote).toBe(false);
    expect(await client.finding.findUnique({ where: { id: row.id } })).toMatchObject({
      status: "approved",
      amountCents: 3_400,
    });
  });
});

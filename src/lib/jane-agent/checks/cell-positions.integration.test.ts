import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

// As the scenario run does (eval.cli.test.ts): the app's own client points at the test database,
// for the upload's job and audit rows.
vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
});
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/categorize/llm", () => ({ classifyMerchants: vi.fn(async () => new Map()) }));

import { createCellPerson } from "./cell";
import { deleteCheckPerson } from "./person";

// Desktop sweep 5's upload S4: Chase checking and a Fidelity positions download. The cell's person
// has the brokerage account and its three holdings as the investments page saves them, beside the
// checking account, so "how much do I have invested?" is asked of what the debugger uploaded.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-18T18:00:00Z");
const CELL = "src/lib/jane-agent/checks/__fixtures__/cells/upload-s4-desktop";

describe.runIf(url)("a walked cell with a positions download", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let id: string | undefined;

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });

  afterAll(async () => {
    if (id) await deleteCheckPerson(id, { client });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("has the brokerage's holdings beside the checking account", async () => {
    id = await createCellPerson(CELL, { client, now: NOW });
    const accounts = await client.account.findMany({
      where: { userId: id },
      orderBy: { name: "asc" },
    });
    expect(accounts.map((a) => [a.source, a.type, a.currentBalanceCents])).toEqual(
      expect.arrayContaining([
        ["csv", "depository", 308_733],
        ["csv", "investment", 831_546],
      ]),
    );
    const holdings = await client.holding.findMany({ where: { userId: id } });
    expect(holdings.map((h) => h.valueCents).sort((a, b) => a - b)).toEqual([
      137_852, 184_022, 509_672,
    ]);
  });
});

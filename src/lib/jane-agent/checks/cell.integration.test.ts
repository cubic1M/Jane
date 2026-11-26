import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
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

import { adviceMode } from "@/lib/advice-mode";
import { createCellPerson } from "./cell";
import { deleteCheckPerson } from "./person";

// A walked cell's person, built from its files through the real upload path, as the scenario run
// makes it (eval.cli.test.ts): its account with the balance typed, every row of its statement, and
// a real account, so advice mode is off.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-03T18:00:00Z");
const CELL = "src/lib/jane-agent/checks/__fixtures__/cells/one-checking";

describe.runIf(url)("a walked cell's person", { timeout: 120_000 }, () => {
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

  it("has the cell's account, balance and rows, on a real account", async () => {
    id = await createCellPerson(CELL, { client, now: NOW });
    const accounts = await client.account.findMany({ where: { userId: id } });
    expect(accounts.map((a) => [a.name, a.source, a.subtype, a.currentBalanceCents])).toEqual([
      ["Chase checking", "csv", "checking", 241_456],
    ]);
    const rows = await client.transaction.findMany({ where: { userId: id } });
    expect(rows).toHaveLength(9);
    expect(rows.reduce((sum, r) => sum + r.amountCents, 0)).toBe(-141_456);
    expect(await adviceMode(id, { client })).toBe(false);
  });
});

describe.runIf(url)("a cell whose setup fails part way", { timeout: 120_000 }, () => {
  it("leaves no person behind and says what went wrong", async () => {
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    const email = `answer-checks-${crypto.randomUUID()}@example.com`;
    const spy = vi.spyOn(crypto, "randomUUID").mockReturnValueOnce(email.slice(14, 50) as never);
    const real = (p: string) => readFileSync(p, "utf8");
    const cell = JSON.parse(real(`${CELL}/cell.json`)) as { accounts: object[] };
    const second = { name: "Second", kind: "checking", files: ["missing.csv"] };
    const read = (p: string) =>
      p.endsWith("cell.json")
        ? JSON.stringify({ accounts: [...cell.accounts, second] })
        : real(p.replace("missing.csv", "nope.csv"));
    await expect(createCellPerson(CELL, { client, now: NOW, read })).rejects.toThrow(/ENOENT/);
    spy.mockRestore();
    expect(await client.user.count({ where: { email } })).toBe(0);
    await client.$disconnect();
  });
});

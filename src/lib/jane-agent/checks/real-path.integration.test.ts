import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { QUESTIONS } from "./bank";
import { createCheckPerson, deleteCheckPerson } from "./person";
import { runRealPath } from "./real-path";

// Plan item 13: a slice of the bank through the real chat on every pull request; the night runs
// all of it (nightly.cli.test.ts). A question that named a tool is the one that can fail on it.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date();
const EVERY = 12;

describe.runIf(url)("the path people are really answered on", { timeout: 300_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = await createCheckPerson({ client, now: NOW });
  });
  afterAll(async () => {
    await deleteCheckPerson(userId, { client });
    await client.$disconnect();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("answers through Claude, never the backup, with no tool failing", async () => {
    const named = QUESTIONS.filter((q) => q.tool && !q.after);
    const questions = named.filter((_, i) => i % EVERY === 0);
    expect(questions.length).toBeGreaterThan(10);
    const run = await runRealPath(userId, { client, now: NOW, questions });
    expect(run.results.filter((r) => !r.ok).map((r) => `${r.id}: ${r.failed.join(", ")}`)).toEqual(
      [],
    );
    expect(run.results.every((r) => r.source === "claude")).toBe(true);
    expect(process.env.ANTHROPIC_API_KEY ?? "").not.toBe("played-back");
  });
});

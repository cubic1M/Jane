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

import type { CheckQuestion } from "./bank";
import { createCellPerson } from "./cell";
import { loadFacts, type Facts } from "./facts";
import { fixedChecks } from "./grade";
import { deleteCheckPerson } from "./person";

// Walk batch 2 (11-18, desktop sweep 5, upload S5): Claude answered "Why was I charged $35 on
// Oct 28?" with "an overdraft fee from Wells Fargo … for a $6.20 item", right and passed by Jane's
// own check, and the scenario grader called it refused: its figures held only the lookups that
// take no input, while the chat had read the finding's details (whose evidence quotes the bank's
// line, "OVERDRAFT FEE FOR A $6.20 ITEM") and searched the transactions. The grader now has both,
// and a figure no lookup gives is still refused.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-18T12:33:00Z");
const CELL = "src/lib/jane-agent/checks/__fixtures__/cells/upload-s5-desktop";
const QUESTION: CheckQuestion = {
  id: "s5",
  text: "Why was I charged $35 on Oct 28?",
  needs: "claude",
  expect: {},
};

describe.runIf(url)("the grader's figures for a Claude answer", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let id: string | undefined;
  let facts: Facts;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    id = await createCellPerson(CELL, { client, now: NOW });
    facts = await loadFacts(id, { client, now: NOW });
  });

  afterAll(async () => {
    if (id) await deleteCheckPerson(id, { client });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  const guardrails = (body: string) =>
    fixedChecks(QUESTION, { body, actions: [], source: "claude" }, facts).find(
      (c) => c.name === "guardrails",
    )!;

  it("passes a figure quoted from the bank's own line, from the finding's details", () => {
    expect(
      guardrails("The $35.00 on Oct 28 was an overdraft fee from Wells Fargo, for a $6.20 item."),
    ).toMatchObject({ ok: true });
  });

  it("passes a transaction's own amount, as a search gives it", () => {
    expect(guardrails("You spent $40.46 at Chipotle on Nov 14.")).toMatchObject({ ok: true });
  });

  it("still refuses a made-up figure of the same shape", () => {
    expect(
      guardrails("The $35.00 on Oct 28 was an overdraft fee from Wells Fargo, for a $6.40 item."),
    ).toMatchObject({ ok: false });
    expect(guardrails("You spent $41.46 at Chipotle on Nov 14.")).toMatchObject({ ok: false });
  });
});

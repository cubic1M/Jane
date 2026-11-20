import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

// As the scenario run does: the app's own client points at the test database.
vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
});
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/categorize/llm", () => ({ classifyMerchants: vi.fn(async () => new Map()) }));

import { stubTestKeys } from "@/lib/__fixtures__/env";
import { answerByRules } from "./answer";
import { createCellPerson } from "./checks/cell";
import { deleteCheckPerson } from "./checks/person";
import { parseIntent } from "./intents";

// The backup chat on the walk's own upload S3 file (Chase checking paying Toyota Motor Credit
// $338.12 on the 7th, walked 11-20): "when is my car payment due?" said "I don't see a regular car
// payment yet" on every desktop sweep from the seventh. It's the car loan's answer, with its next
// payment.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-20T19:00:00Z");

describe.runIf(url)("when the car payment is due, on upload S3", { timeout: 300_000 }, () => {
  let client: PrismaClient;
  let id: string;

  beforeAll(async () => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    id = await createCellPerson("src/lib/jane-agent/checks/__fixtures__/cells/upload-s3-phone", {
      client,
      now: NOW,
    });
  });

  afterAll(async () => {
    await deleteCheckPerson(id, { client });
    await client.$disconnect();
  });

  it.each(["When is my car payment due?", "how much is my car payment?"])(
    "%s names the lender, the payment and the next one",
    async (question) => {
      const reply = await answerByRules(id, parseIntent(question, "2026-11-20"), {
        client,
        now: NOW,
      });
      expect(reply?.body).not.toMatch(/I don't see a regular/);
      expect(reply?.body).toMatch(/Toyota/i);
      expect(reply?.body).toContain("$338.12");
      expect(reply?.body).toMatch(/Dec 7/);
    },
  );
});

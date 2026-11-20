import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

// As the scenario run does (checks/eval.cli.test.ts): the upload's job writes through the app's
// own client, pointed at the test database.
vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
});
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/categorize/llm", () => ({ classifyMerchants: vi.fn(async () => new Map()) }));

import { createCellPerson } from "./checks/cell";
import { deleteCheckPerson } from "./checks/person";
import { runChatTool } from "./claude-tools";

// Walk batch 3's upload S1 (phone, 11-20), on the walked file: "how much is my electric bill?" got
// "Xcel Energy is $57.49 a month, $689.88 a year", from the numbers every chat starts with
// (coming_up), over bills of $46.60, $38.72 and $57.49. Both of the chat's bill lists now say the
// range and the usual amount.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-20T18:00:00Z");
const CELL = "src/lib/jane-agent/checks/__fixtures__/cells/upload-s1-phone-6";

describe.runIf(url)(
  "a bill that moves with use, in the chat's bill lists",
  { timeout: 120_000 },
  () => {
    let client: PrismaClient;
    let id = "";

    beforeAll(async () => {
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
      id = await createCellPerson(CELL, { client, now: NOW });
    });

    afterAll(async () => {
      if (id) await deleteCheckPerson(id, { client });
      await client.$disconnect();
      vi.unstubAllEnvs();
    });

    const xcel = (items: { merchant?: string; what?: string }[]) =>
      items.find((i) => /xcel/i.test(i.merchant ?? i.what ?? ""));

    it("gives Xcel's range and usual amount where it starts, and in the subscriptions list", async () => {
      const coming = await runChatTool(id, "coming_up", {}, { client, now: NOW });
      const bill = xcel(JSON.parse(coming.content).items);
      expect(bill).toMatchObject({
        amount: "$57.49",
        varies: { from: "$38.72", to: "$57.49", usual: "$47.60" },
      });
      // Each figure is one the guardrails will let Claude say.
      expect(coming.cents).toEqual(expect.arrayContaining([3_872, 5_749, 4_760]));
      const charges = await runChatTool(id, "subscriptions", {}, { client, now: NOW });
      expect(xcel(JSON.parse(charges.content).charges)).toMatchObject({
        lastCharge: "$57.49",
        aYear: "$689.88",
        varies: { from: "$38.72", to: "$57.49", usual: "$47.60" },
      });
    });

    it("gives no range for a fixed bill or a subscription whose price went up", async () => {
      const { charges } = JSON.parse(
        (await runChatTool(id, "subscriptions", {}, { client, now: NOW })).content,
      ) as { charges: { merchant: string; varies?: unknown }[] };
      for (const c of charges.filter((c) => /hulu|t-mobile|dinkytown/i.test(c.merchant))) {
        expect(c.varies, c.merchant).toBeUndefined();
      }
    });
  },
);

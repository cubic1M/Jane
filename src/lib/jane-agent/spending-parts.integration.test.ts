import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { createCheckPerson, deleteCheckPerson } from "./checks/person";
import { runChatTool } from "./claude-tools";

// Night round 11-06: Claude's spending tool gave Food and drink as one number, so "how much on
// groceries" had only restaurants-and-all to go on. It now gives the parts asked about by name.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-05T23:00:00Z");

describe.runIf(url)(
  "the parts of a category in Claude's spending tool",
  { timeout: 180_000 },
  () => {
    let client: PrismaClient;
    let id = "";

    beforeAll(async () => {
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
      id = await createCheckPerson({ client, now: NOW, person: "renter" });
    });

    afterAll(async () => {
      await deleteCheckPerson(id, { client }).catch(() => {});
      await client.$disconnect();
    });

    it("gives groceries and rent inside their categories, each no more than the whole", async () => {
      const out = JSON.parse(
        (await runChatTool(id, "spending_by_category", { month: "2026-10" }, { client, now: NOW }))
          .content,
      ) as {
        categories: {
          category: string;
          amount: string;
          parts?: { part: string; amount: string }[];
        }[];
      };
      const cents = (s: string) => Math.round(Number(s.replace(/[$,]/g, "")) * 100);
      const food = out.categories.find((c) => c.category === "Food and drink")!;
      const groceries = food.parts?.find((p) => p.part === "groceries");
      expect(groceries).toBeDefined();
      expect(cents(groceries!.amount)).toBeLessThan(cents(food.amount));
      const home = out.categories.find((c) => c.category === "Rent and utilities")!;
      expect(home.parts?.map((p) => p.part)).toContain("rent");
      for (const c of out.categories) {
        const sum = (c.parts ?? []).reduce((s, p) => s + cents(p.amount), 0);
        expect(sum).toBeLessThanOrEqual(cents(c.amount));
      }
    });
  },
);

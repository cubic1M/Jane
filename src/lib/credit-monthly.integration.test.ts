import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { setAutopilot } from "@/lib/autopilot";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { creditMonthlySource } from "@/lib/jane-agent/sources/credit-monthly";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { sendToJane } from "@/lib/jane-agent/typing";
import { parseActions } from "@/lib/jane-agent/types";
import { demoLender } from "@/lib/lenders/demo";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { setSectorAutopilot } from "@/lib/sector-autopilot";
import { loadCreditMonthly, runCreditMonthly } from "./credit-monthly";

// Spec step 251 against a real, migrated Postgres, on the demo bank: the monthly credit
// check-up after Jane's soft checks, kept so the chat posts it once as one message with a
// button per item, what Jane does on its own at each level, and nothing that runs a hard pull
// or opens an account without a tap.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const NEXT = new Date("2026-11-03T15:00:00Z");
const context = { now: LINKED, local: { date: "2026-10-18", hour: 8 }, trigger: "open" as const };

describe.runIf(url)(
  "the monthly credit check-up against a real database",
  { timeout: 120_000 },
  () => {
    let client: PrismaClient;
    const created: string[] = [];
    const plaid = new Proxy(
      {},
      {
        get: () => () => {
          throw new Error("The demo bank must never call Plaid");
        },
      },
    ) as PlaidApi;
    const opts = (now = LINKED) => ({ client, now });
    async function demoPerson(prefix: string) {
      const user = await client.user.create({
        data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
      });
      created.push(user.id);
      const { itemId } = await linkDemoBank(user.id, { client, now: LINKED });
      await syncItem(itemId, { client, api: plaid, now: LINKED });
      return user.id;
    }
    const noHardPulls = async (id: string) => {
      expect(await client.loanApplication.count({ where: { userId: id } })).toBe(0);
      expect(await client.cardApplication.count({ where: { userId: id } })).toBe(0);
    };

    beforeAll(async () => {
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      vi.stubEnv("PLAID_CLIENT_ID", "");
      vi.stubEnv("PLAID_SECRET", "");
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    }, 120_000);
    afterAll(async () => {
      await client.user.deleteMany({ where: { id: { in: created } } });
      await client.$disconnect();
      vi.unstubAllEnvs();
    });

    it("is done by Jane's first run after linking, once a month, at Ask me first doing nothing", async () => {
      const id = await demoPerson("cm-ask");
      const apply = vi.spyOn(demoLender, "apply");
      const m = (await loadCreditMonthly(id, opts()))!;
      expect(m).toMatchObject({ available: true, level: "ask", month: "2026-10", did: [] });
      expect(m.checkedOn).toBe("2026-10-18");
      const keys = m.items.map((i) => [i.key, i.status]);
      expect(keys[0]).toEqual(["soft_checks", "done"]);
      // The demo bank's payday loans and pay advances in the last 30 days.
      expect(keys).toContainEqual(["costly", "tap"]);
      // Every item that waits says where the person acts.
      for (const i of m.items.filter((x) => x.status === "tap"))
        expect(i.link?.href).toMatch(/^\/loans\//);
      // Not again this month.
      expect(await runCreditMonthly(id, opts())).toBeNull();
      expect(await client.cardRateRequest.count({ where: { userId: id } })).toBe(0);
      expect(apply).not.toHaveBeenCalled();
      await noHardPulls(id);
    });

    it("posts one message with a button per page that waits, once for the month", async () => {
      const id = await demoPerson("cm-msg");
      const [msg] = creditMonthlySource.gather((await loadSnapshot(id, opts()))!, context);
      expect(msg).toMatchObject({ kind: "decision", dedupeKey: "creditmonth:2026-10" });
      expect(msg.body).toMatch(
        /^This month's credit check-up: \d+ things? needs? you, and I handled 1\./,
      );
      expect(msg.body).toContain("Rates and what you could borrow (Done)");
      const hrefs = parseActions(msg.actions).map((a) => ("href" in a ? a.href : null));
      expect(hrefs).toContain("/loans/costly");
      expect(hrefs).toContain("/loans/review");
      expect(new Set(hrefs).size).toBe(hrefs.length);
    });

    it("sends the next lower-rate request itself at Handle everything, and never applies", async () => {
      const id = await demoPerson("cm-all");
      await setAutopilot(id, "all", { client });
      await setSectorAutopilot(
        id,
        "debt",
        { level: "all", actionCapCents: 200_000, monthlyCapCents: 300_000 },
        { client, now: NEXT },
      );
      const apply = vi.spyOn(demoLender, "apply");
      const ran = (await runCreditMonthly(id, opts(NEXT)))!;
      expect(ran.month).toBe("2026-11");
      expect(ran.did).toHaveLength(1);
      expect(ran.did[0]).toMatch(/^a lower-rate request to /);
      expect(ran.items.find((i) => i.key === "card_rate")?.status).toBe("done");
      expect(await client.cardRateRequest.count({ where: { userId: id } })).toBe(1);
      expect(apply).not.toHaveBeenCalled();
      await noHardPulls(id);
    });

    it("answers in the chat, and gives Claude the same items", async () => {
      const id = await demoPerson("cm-chat");
      const { reply } = await sendToJane(id, "what's in my credit check-up this month?", opts());
      expect(reply.body).toMatch(/^This month's credit check-up: /);
      expect(reply.body).toContain("Nothing that runs a hard credit check or opens an account");
      const tool = JSON.parse((await runChatTool(id, "credit_monthly", {}, opts())).content);
      expect(tool).toMatchObject({
        month: "2026-10",
        doneOn: "2026-10-18",
        noHardPullsWithoutATap: true,
      });
      expect(tool.items[0]).toMatchObject({
        title: "Rates and what you could borrow",
        status: "done by Jane",
      });
    });
  },
);

import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { logAudit } from "@/lib/audit";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { carLoanSource } from "@/lib/jane-agent/sources/car-loan";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { sendToJane } from "@/lib/jane-agent/typing";
import { parseActions } from "@/lib/jane-agent/types";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import {
  CarLoanError,
  addTypedAddon,
  confirmAddon,
  loadCarLoan,
  refreshCarLoan,
  requestCancellation,
} from "./car-loan";

// Spec step 245 against a real, migrated Postgres, on the demo bank (a car loan from Toyota
// Financial): the refinance compared by total cost, a dealer add-on found in the payments and
// asked about once, the refund and the cancellation, to send or to hand to the team.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const MINUTE = 60 * 1000;
const context = { now: LINKED, local: { date: "2026-10-18", hour: 8 }, trigger: "open" as const };

describe.runIf(url)(
  "the car loan you already have against a real database",
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
    let tick = 0;
    const later = () => new Date(LINKED.getTime() + ++tick * MINUTE);
    const opts = (now = LINKED) => ({ client, now });
    async function demoPerson(prefix: string) {
      const user = await client.user.create({
        data: { email: `${prefix}-${crypto.randomUUID()}@example.com`, name: "Sam Demo" },
      });
      created.push(user.id);
      const { itemId } = await linkDemoBank(user.id, { client, now: LINKED });
      await syncItem(itemId, { client, api: plaid, now: LINKED });
      return user.id;
    }
    async function pay(userId: string, date: string, amountCents: number, description: string) {
      const account = await client.account.findFirstOrThrow({
        where: { userId, subtype: "checking" },
      });
      await client.transaction.create({
        data: {
          id: `t${crypto.randomUUID()}`,
          userId,
          accountId: account.id,
          source: "plaid",
          date: new Date(`${date}T00:00:00Z`),
          amountCents,
          description,
          pfcPrimary: "GENERAL_MERCHANDISE",
          pfcDetailed: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
          pending: false,
        },
      });
    }
    const fromSource = async (id: string) =>
      carLoanSource.gather((await loadSnapshot(id, opts()))!, context);

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

    it("compares a refinance by total cost and says when there's no add-on", async () => {
      const id = await demoPerson("car-refi");
      const d = await loadCarLoan(id, opts());
      expect(d).toMatchObject({ available: true, advice: true });
      expect(d.loan!.name).toMatch(/Toyota|Auto|Car/i);
      if (d.refi) {
        expect(d.refi.currentTotalCents - d.refi.newTotalCents).toBe(d.refi.savingCents);
      }
      expect(await fromSource(id)).toEqual([]);
      const { reply } = await sendToJane(id, "do I have gap insurance on my car loan", {
        client,
        now: later(),
      });
      expect(reply.body).toMatch(/^Your .* has \$[\d,.]+ left/);
      expect(reply.body).toContain("I haven't found a dealer add-on");
      // Doesn't exist for someone without a car loan.
      const user = await client.user.create({
        data: { email: `car-none-${crypto.randomUUID()}@example.com` },
      });
      created.push(user.id);
      expect((await loadCarLoan(user.id, opts())).available).toBe(false);
    });

    it("finds an add-on in the payments, asks once, and drafts the cancellation", async () => {
      const id = await demoPerson("car-addon");
      await pay(id, "2025-10-18", 69_500, "DEALER GAP INSURANCE");
      await pay(id, "2025-10-18", 3_000, "WARRANTY SMALL");
      const d = await loadCarLoan(id, opts());
      expect(d.candidates.map((c) => [c.kind, c.paidCents])).toEqual([["gap", 69_500]]);
      // 12 of 72 months used: 60 unused, $579.17 before the $50 fee.
      expect(d.candidates[0].refund).toMatchObject({ monthsUsed: 12, monthsLeft: 60 });
      const [ask] = await fromSource(id);
      expect(ask).toMatchObject({
        kind: "decision",
        refs: { carAddon: { key: d.candidates[0].key } },
      });
      expect(parseActions(ask.actions).map((a) => a.id)).toEqual([
        "caraddon.yes",
        "caraddon.no",
        "snooze",
      ]);

      const { reply } = await sendToJane(id, "can I cancel my gap coverage", {
        client,
        now: later(),
      });
      expect(parseActions(reply.actions)[0].id).toBe("caraddon.yes");
      const tapped = await takeChatAction(id, reply.id, "caraddon.yes", { client, now: later() });
      expect(tapped.message.refs.note).toMatch(/^Noted\. Cancelling it now could refund about \$/);
      const after = await loadCarLoan(id, opts());
      expect(after.candidates).toEqual([]);
      const addon = after.addons[0];
      expect(addon).toMatchObject({ status: "confirmed", worthCancelling: true });
      expect(addon.letter).toContain("cancel my GAP cover");
      expect(logAuditCalled("car_addon_confirmed")).toBe(true);

      // The refund question: the team can send it; Jane sends nothing itself.
      const [refund] = await fromSource(id);
      expect(refund).toMatchObject({
        dedupeKey: `caraddon_refund:${addon.id}`,
        refs: { carAddon: { id: addon.id } },
      });
      expect(
        parseActions(refund.actions)
          .map((a) => a.id)
          .slice(0, 2),
      ).toEqual(["caraddon.mine", "caraddon.team"]);
      const { reply: again } = await sendToJane(id, "can I cancel my gap coverage", {
        client,
        now: later(),
      });
      const team = await takeChatAction(id, again.id, "caraddon.team", { client, now: later() });
      expect(team.message.refs.note).toMatch(/^Done: the team has the request/);
      expect((await loadCarLoan(id, opts())).addons[0].status).toBe("team");
      expect(await fromSource(id)).toEqual([]);
      await expect(requestCancellation(id, addon.id!, "mine", opts())).rejects.toThrow(
        CarLoanError,
      );
    });

    it("never offers the team to a real account: the person sends it (read-only mode)", async () => {
      const id = await demoPerson("car-addon-real");
      // A real bank next to the demo bank makes it a real account.
      await client.plaidItem.create({
        data: {
          userId: id,
          plaidItemId: `item-${crypto.randomUUID()}`,
          accessTokenEncrypted: "test",
          institutionName: "First Real Bank",
        },
      });
      await pay(id, "2025-10-18", 69_500, "DEALER GAP INSURANCE");
      const [candidate] = (await loadCarLoan(id, opts())).candidates;
      await confirmAddon(id, candidate.key, {}, { client, now: later() });
      const loan = await loadCarLoan(id, opts());
      expect(loan.team).toBe(false);
      const addon = loan.addons[0];

      const [refund] = await fromSource(id);
      expect(parseActions(refund.actions).map((a) => a.id)).not.toContain("caraddon.team");
      expect(refund.body).toContain("send it yourself");
      expect(refund.body).not.toMatch(/the team/);
      await expect(requestCancellation(id, addon.id!, "team", opts())).rejects.toThrow(
        CarLoanError,
      );
      await requestCancellation(id, addon.id!, "mine", opts());
      expect((await loadCarLoan(id, opts())).addons[0].status).toBe("mine");
    });

    it("takes an add-on typed in, and refuses a bad one", async () => {
      const id = await demoPerson("car-typed");
      await addTypedAddon(
        id,
        {
          kind: "service",
          name: "Toyota Care",
          paidCents: 36_000,
          termMonths: 36,
          startedOn: "2025-10-18",
        },
        opts(),
      );
      const d = await loadCarLoan(id, opts());
      expect(d.addons[0]).toMatchObject({ kind: "service", label: "Service contract" });
      expect(d.addons[0].refund).toMatchObject({
        monthsLeft: 24,
        proRataCents: 24_000,
        refundCents: 19_000,
      });
      const tool = JSON.parse((await runChatTool(id, "car_loan", {}, opts())).content);
      expect(tool.confirmedAddOns[0].estimatedRefund).toBe("$190.00");
      await expect(
        addTypedAddon(
          id,
          { kind: "tires", name: "x", paidCents: 50_000, termMonths: 12, startedOn: "2025-01-01" },
          opts(),
        ),
      ).rejects.toThrow(CarLoanError);
      await expect(
        addTypedAddon(
          id,
          { kind: "gap", name: "x", paidCents: 50_000, termMonths: 12, startedOn: "2030-01-01" },
          opts(),
        ),
      ).rejects.toThrow(CarLoanError);
      await expect(confirmAddon(id, "tx:nope", {}, opts())).rejects.toThrow(CarLoanError);
    });

    it("notices rates that fell or a better band once", async () => {
      const id = await demoPerson("car-watch");
      expect(await refreshCarLoan(id, opts())).toBeNull();
      const row = await client.carLoanWatch.findFirstOrThrow({ where: { userId: id } });
      // Pretend the last check saw higher rates and a worse band.
      await client.carLoanWatch.update({
        where: { id: row.id },
        data: { bestAprBps: row.bestAprBps! + 100 },
      });
      if (row.bestAprBps !== null) {
        expect(await refreshCarLoan(id, opts())).toBe("rates_fell");
        expect((await loadCarLoan(id, opts())).change).toEqual({
          kind: "rates_fell",
          on: "2026-10-18",
        });
        expect(await refreshCarLoan(id, opts())).toBeNull();
      }
      await client.carLoanWatch.update({
        where: { id: row.id },
        data: { band: "fair", bestAprBps: row.bestAprBps },
      });
      expect(await refreshCarLoan(id, opts())).toBe("score_rose");
    });
  },
);

import { vi as viMock } from "vitest";
function logAuditCalled(event: string) {
  return viMock.mocked(logAudit).mock.calls.some((c) => c[1] === event);
}

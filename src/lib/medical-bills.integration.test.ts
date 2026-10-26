import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { logAudit } from "@/lib/audit";
import { medicalBillsSource } from "@/lib/jane-agent/sources/medical-bills";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { sendToJane } from "@/lib/jane-agent/typing";
import { parseActions } from "@/lib/jane-agent/types";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import {
  MedicalBillError,
  addMedicalBill,
  loadMedicalBills,
  refreshMedicalBills,
  sendMedicalItem,
} from "./medical-bills";

// Spec step 180 against a real, migrated Postgres, on the demo bank (a $180 dental bill in
// its payments): bills found and typed, the requests written with amounts from the bills,
// each sent only on a tap and once, the provider stand-in's answers, and nothing sent for a
// real account.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const context = { now: LINKED, local: { date: "2026-10-18", hour: 8 }, trigger: "open" as const };

describe.runIf(url)("medical bills against a real database", { timeout: 120_000 }, () => {
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
  async function person(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  }
  async function demoPerson(prefix: string) {
    const id = await person(prefix);
    const { itemId } = await linkDemoBank(id, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    return id;
  }

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

  it("finds the dental bill in the payments, with amounts matching it", async () => {
    const id = await demoPerson("med-find");
    const data = await loadMedicalBills(id, opts());
    expect(data.available).toBe(true);
    const dental = data.bills.find((b) => b.provider.toLowerCase().includes("bright smiles"))!;
    expect(dental).toMatchObject({ amountCents: 18_000, source: "payment" });
    // The pharmacy's $23.40 is under the minimum and isn't a bill.
    expect(data.bills.every((b) => b.amountCents >= 10_000)).toBe(true);
    for (const item of dental.items) expect(item.body).toContain("$180.00");
    expect(dental.items.map((i) => i.kind)).toContain("itemized");
  });

  it("adds a typed bill, and writes assistance and a plan for a big one", async () => {
    const id = await demoPerson("med-typed");
    await expect(
      addMedicalBill(id, { provider: "", amount: "100", billedOn: "2026-09-01" }, opts()),
    ).rejects.toThrow(MedicalBillError);
    await expect(
      addMedicalBill(
        id,
        { provider: "Mercy Hospital", amount: "abc", billedOn: "2026-09-01" },
        opts(),
      ),
    ).rejects.toThrow(MedicalBillError);
    await addMedicalBill(
      id,
      { provider: "Mercy Hospital", amount: "2400", billedOn: "2026-09-01" },
      opts(),
    );
    const data = await loadMedicalBills(id, opts());
    const mercy = data.bills.find((b) => b.provider === "Mercy Hospital")!;
    expect(mercy).toMatchObject({ amountCents: 240_000, source: "typed" });
    const kinds = mercy.items.map((i) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(["itemized", "assistance", "plan"]));
    expect(mercy.items.find((i) => i.kind === "assistance")!.body).toContain("$2,400.00");
    expect(mercy.items.find((i) => i.kind === "plan")!.body).toContain(
      "24 equal monthly payments of $100.00",
    );
  });

  it("brings the bill up with a request ready, and sends nothing itself", async () => {
    const id = await demoPerson("med-chat");
    const snapshot = (await loadSnapshot(id, opts()))!;
    const [found] = medicalBillsSource
      .gather(snapshot, context)
      .filter((c) => c.dedupeKey.startsWith("medical:"));
    expect(found.kind).toBe("decision");
    expect(found.body).toMatch(/charged \$180\.00 on /);
    expect(found.body).toContain("nothing is sent until you tap");
    expect(found.actions[0]).toMatchObject({ id: "medical.send" });
    expect(await client.medicalRequest.count({ where: { userId: id } })).toBe(0);
  });

  it("sends one request per tap, once, audited, and the provider answers after two days", async () => {
    const id = await demoPerson("med-send");
    await addMedicalBill(
      id,
      { provider: "Mercy Hospital", amount: "2400", billedOn: "2026-09-01" },
      opts(),
    );
    const { reply } = await sendToJane(id, "I have a hospital bill I can't pay", {
      client,
      now: later(),
    });
    expect(reply.body).toMatch(/^I found \d medical bills? totalling \$[\d,.]+\./);
    expect(parseActions(reply.actions)[0].id).toBe("medical.send");
    const tapped = await takeChatAction(id, reply.id, "medical.send", { client, now: later() });
    expect(tapped.message.refs.note).toMatch(/^Sent to .*\. I'll tell you what they answer\./);
    const rows = await client.medicalRequest.findMany({ where: { userId: id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "sent", partner: "demo" });
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      { type: "user", id },
      "medical_request_sent",
      expect.objectContaining({ type: "medical_request" }),
      expect.objectContaining({ kind: rows[0].kind }),
    );
    await expect(sendMedicalItem(id, rows[0].key, opts())).rejects.toThrow(MedicalBillError);
    await expect(sendMedicalItem(id, "plan:nothing", opts())).rejects.toThrow(MedicalBillError);
    expect(await refreshMedicalBills(id, opts())).toBe(0);
    const after = new Date(LINKED.getTime() + 3 * DAY);
    expect(await refreshMedicalBills(id, opts(after))).toBe(1);
    const row = await client.medicalRequest.findFirstOrThrow({ where: { userId: id } });
    expect(["granted", "declined"]).toContain(row.status);
    // Assistance takes 40% off the bill's own amount; the answer says so.
    if (row.kind === "assistance" && row.status === "granted") {
      expect(row.savedCents).toBe(96_000);
      expect(row.outcome).toBe("Approved: $960.00 off the bill, leaving $1,440.00.");
    }
    const snapshot = (await loadSnapshot(id, opts(after)))!;
    const answer = medicalBillsSource
      .gather(snapshot, { ...context, now: after })
      .find((c) => c.dedupeKey === `medical_answer:${row.id}`);
    expect(answer).toBeDefined();
    const tool = JSON.parse((await runChatTool(id, "medical_bills", {}, opts(after))).content);
    expect(tool.alwaysNeedsATap).toBe("sending any request");
  });

  it("never sends anything for a real account", async () => {
    const realId = await person("med-real");
    expect((await loadMedicalBills(realId, opts())).available).toBe(false);
    await expect(sendMedicalItem(realId, "itemized:tx:x", opts())).rejects.toThrow(
      MedicalBillError,
    );
    await expect(
      addMedicalBill(realId, { provider: "Mercy", amount: "100", billedOn: "2026-09-01" }, opts()),
    ).rejects.toThrow(MedicalBillError);
    expect(await client.medicalRequest.count({ where: { userId: realId } })).toBe(0);
  });
});

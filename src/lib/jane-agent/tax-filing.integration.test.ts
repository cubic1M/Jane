import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { logAudit } from "@/lib/audit";
import { setAutopilot } from "@/lib/autopilot";
import { filingPartnerFor } from "@/lib/filing";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { runTaxAutopilot } from "@/lib/tax-autopilot";
import { FilingError, inFilingSeason, loadReturn, signReturn, startReturn } from "@/lib/tax-filing";
import { loadTaxForms, markTaxForm } from "@/lib/tax-organizer";
import { saveTaxAnswers } from "@/lib/tax-profile";
import { takeChatAction } from "./actions";
import { runChatTool } from "./claude-tools";
import { loadSnapshot } from "./snapshot";
import { taxesSource } from "./sources/taxes";
import { sendToJane } from "./typing";

// Spec step 126 against a real, migrated Postgres: in February, Jane hands the demo bank's
// 2026 over to the stand-in filing partner; the return is only submitted once the person
// has reviewed it and signed; it's tracked to accepted. Real accounts can't file through it.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const FEB = new Date("2027-02-10T16:00:00Z");
const HOUR = 60 * 60 * 1000;

describe.runIf(url)("filing through the partner against a real database", () => {
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

  async function demoPerson(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    return user.id;
  }
  const answer = (userId: string) =>
    saveTaxAnswers(
      userId,
      [
        { field: "filingStatus", value: "single" },
        { field: "dependants", childrenUnder17: 0, otherDependants: 0 },
      ],
      { client, via: "page" },
    );
  const gather = async (userId: string, now: Date) =>
    taxesSource.gather((await loadSnapshot(userId, { client, now }))!, {
      now,
      local: { date: now.toISOString().slice(0, 10), hour: 8 },
      trigger: "open",
    });

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("knows filing season", () => {
    expect(inFilingSeason(2026, "2027-01-19")).toBe(false);
    expect(inFilingSeason(2026, "2027-02-10")).toBe(true);
    expect(inFilingSeason(2026, "2027-10-15")).toBe(true);
    expect(inFilingSeason(2026, "2027-10-16")).toBe(false);
  });

  it("offers to start in season, only once the profile's answered, and starts from the chat", async () => {
    const userId = await demoPerson("tax-file");
    const offer = (await gather(userId, FEB)).find((c) => c.dedupeKey === "file:2026")!;
    expect(offer.body).toContain(
      "First, tell me how you file and your dependants on your tax profile.",
    );
    expect(offer.actions.map((a) => a.id)).toEqual(["open", "snooze"]);
    await expect(startReturn(userId, { client, now: FEB, via: "page" })).rejects.toThrow(
      "First tell me how you file",
    );

    await answer(userId);
    const ready = (await gather(userId, FEB)).find((c) => c.dedupeKey === "file:2026")!;
    expect(ready.actions[0].id).toBe("tax.file_start");
    const message = await client.janeMessage.create({
      data: {
        userId,
        kind: ready.kind,
        body: ready.body,
        refs: ready.refs,
        actions: ready.actions,
        dedupeKey: `taxes:${ready.dedupeKey}`,
      },
    });
    const after = (await takeChatAction(userId, message.id, "tax.file_start", { client, now: FEB }))
      .message;
    expect(after.refs.note).toMatch(/^Started: your 2026 return is ready to review \(federal, /);
    const ret = await loadReturn(userId, 2026, { client, now: FEB });
    expect(ret).toMatchObject({ status: "ready_for_review", signedAt: null, submittedAt: null });
    expect(ret!.package.profile).toMatchObject({ filingStatus: "single", state: "CA" });
    expect(ret!.package.forms.map((f) => f.form)).toContain("W-2");
    // What's handed over has no account numbers or tokens.
    expect(JSON.stringify(ret!.package)).not.toMatch(/access|token|demo-[a-f0-9]{16}/i);
    expect((await gather(userId, FEB)).some((c) => c.dedupeKey === "review:2026")).toBe(true);
  });

  it("is never submitted without the person's review and signature", async () => {
    const userId = await demoPerson("tax-file-sign");
    await answer(userId);
    await startReturn(userId, { client, now: FEB, via: "page" });
    await expect(
      signReturn(
        userId,
        { year: 2026, reviewed: false, signature: "Alex Rivera" },
        { client, now: FEB },
      ),
    ).rejects.toThrow("Tick that you've reviewed");
    await expect(
      signReturn(userId, { year: 2026, reviewed: true, signature: "  " }, { client, now: FEB }),
    ).rejects.toThrow("Sign with your full name");
    await expect(
      signReturn(userId, { year: 2026, reviewed: true, signature: "Alex" }, { client, now: FEB }),
    ).rejects.toThrow("Sign with your full name");
    expect((await loadReturn(userId, 2026, { client, now: FEB }))!.status).toBe("ready_for_review");

    const signed = await signReturn(
      userId,
      { year: 2026, reviewed: true, signature: "Alex  Rivera" },
      { client, now: FEB },
    );
    expect(signed).toMatchObject({ status: "submitted", signerName: "Alex Rivera" });
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: userId },
      "tax_return_signed",
      { type: "tax_return", id: signed.id },
      { year: 2026 },
    );
    await expect(
      signReturn(
        userId,
        { year: 2026, reviewed: true, signature: "Alex Rivera" },
        { client, now: FEB },
      ),
    ).rejects.toThrow("already been signed");
    // Tracked to accepted by the partner a day later.
    expect(
      (await loadReturn(userId, 2026, { client, now: new Date(FEB.getTime() + 2 * HOUR) }))!.status,
    ).toBe("submitted");
    const later = new Date(FEB.getTime() + 25 * HOUR);
    expect((await loadReturn(userId, 2026, { client, now: later }))!.status).toBe("accepted");
    expect(
      (await gather(userId, later)).find((c) => c.dedupeKey === "accepted:2026")?.body,
    ).toMatch(/^Your 2026 return was accepted\./);
    const tool = JSON.parse(
      (await runChatTool(userId, "tax_return", {}, { client, now: later })).content,
    );
    expect(tool).toMatchObject({
      year: 2026,
      availableThroughJane: true,
      return: { status: "accepted", signedBy: "Alex Rivera" },
    });
  });

  it("starts by itself at Handle the safe stuff once every form is in, never signing", async () => {
    const userId = await demoPerson("tax-file-auto");
    await answer(userId);
    await setAutopilot(userId, "safe", { client, now: FEB });
    expect((await runTaxAutopilot(userId, { client, now: FEB })).returnStarted).toBe(false);
    for (const f of (await loadTaxForms(userId, 2026, { client, now: FEB })).forms) {
      await markTaxForm(userId, 2026, f.key, true, { client, now: FEB, via: "page" });
    }
    expect((await runTaxAutopilot(userId, { client, now: FEB })).returnStarted).toBe(true);
    expect((await loadReturn(userId, 2026, { client, now: FEB }))!.status).toBe("ready_for_review");
  });

  it("isn't offered outside filing season or for real accounts", async () => {
    const userId = await demoPerson("tax-file-out");
    await answer(userId);
    await expect(startReturn(userId, { client, now: LINKED, via: "page" })).rejects.toThrow(
      "opens in late January",
    );
    const { reply } = await sendToJane(userId, "when are my taxes due", { client, now: LINKED });
    expect(reply.body).toMatch(
      /^Returns for 2025 are due April 15, 2026 \(October 15 with an extension\)\. Filing opens/,
    );

    const real = await client.user.create({
      data: { email: `tax-file-real-${crypto.randomUUID()}@example.com` },
    });
    created.push(real.id);
    await client.account.create({
      data: {
        userId: real.id,
        source: "csv",
        name: "Checking",
        type: "depository",
        subtype: "checking",
      },
    });
    expect(await filingPartnerFor(real.id, { client })).toBeNull();
    await expect(startReturn(real.id, { client, now: FEB, via: "page" })).rejects.toBeInstanceOf(
      FilingError,
    );
  });
});

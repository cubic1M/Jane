import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HELD_DAYS, STOP_GRACE_DAYS } from "@/config/outcomes";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { addDays } from "@/detection/units";
import { logAudit } from "@/lib/audit";
import { dayLabel } from "@/lib/day-label";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { savingsLedger } from "@/lib/ledger";
import { markSuggestionDone, recordShown, verifyOutcomes } from "@/lib/outcomes";
import { syncItem } from "@/lib/plaid/sync";
import { verifiedSavings } from "@/lib/savings-proof";
import { startTrial } from "@/lib/trial";
import { checkResults } from "@/lib/worked";

// The savings ledger on a sample person's demo bank (Maya, the renter), against a real Postgres:
// her dated transactions walk a fix of her own from Estimated to Done, Verified and Held, each
// move written to the audit log, and the headline counts only what is Verified or Held. Jane's
// past wins for her (a cancelled class pass, a refund) are Held by now, with their lines.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-23T15:00:00Z");
const at = (day: string) => new Date(`${day}T15:00:00Z`);
const KEY = "subscriptions:subscription_review";

describe.runIf(url)("the savings ledger, on a sample person", { timeout: 240_000 }, () => {
  let client: PrismaClient;
  let userId = "";

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const trial = await startTrial({ client, now: NOW, defer: true, person: "renter" });
    await syncItem(trial.itemId, { client, now: NOW });
    userId = trial.userId;
  }, 600_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });
  beforeEach(() => vi.mocked(logAudit).mockClear());

  const moves = () =>
    vi
      .mocked(logAudit)
      .mock.calls.filter(([, event]) => event === "saving_state_changed")
      .map(([, , target, meta]) => [target?.type, meta?.from, meta?.to]);

  it("shows Jane's past wins as Held, with their lines, and stamps them once", async () => {
    const ledger = await savingsLedger(userId, { client, now: NOW });
    const jane = ledger.entries.filter((e) => e.by === "jane");
    expect(jane.map((e) => e.state)).toEqual(["held", "held"]);
    for (const e of jane) {
      expect(e.lines).toHaveLength(1);
      expect(addDays(e.verifiedOn!, HELD_DAYS)).toBe(e.heldOn);
    }
    expect(ledger.savedCents).toBe(
      (await verifiedSavings(userId, { client, now: NOW })).confirmedCents,
    );
    expect(ledger.heldCents).toBe(ledger.savedCents);

    // Stamped and audited once (the nightly check; the sync's own run may have done it already).
    await client.action.updateMany({
      where: { userId },
      data: { savingVerifiedAt: null, savingHeldAt: null },
    });
    await checkResults(userId, { client, now: NOW });
    expect(moves()).toEqual([
      ["action", "done", "held"],
      ["action", "done", "held"],
    ]);
    const stamped = await client.action.findMany({ where: { userId } });
    expect(stamped.every((a) => a.savingVerifiedAt && a.savingHeldAt)).toBe(true);
    vi.mocked(logAudit).mockClear();
    await checkResults(userId, { client, now: NOW });
    expect(moves()).toEqual([]);
  });

  it("walks her own fix from Estimated to Held on her dated transactions", async () => {
    // Her own fix of the same class pass: Jane's win for it is set aside, so the transactions
    // alone decide.
    await client.action.deleteMany({ where: { userId } });
    const charges = await client.transaction.findMany({
      where: { userId, description: { contains: "CLASSPASS" }, amountCents: { gt: 0 } },
      orderBy: { date: "asc" },
    });
    expect(charges.length).toBeGreaterThan(0);
    const last = charges.at(-1)!;
    const lastDay = last.date.toISOString().slice(0, 10);
    await client.suggestion.create({
      data: {
        userId,
        key: KEY,
        capability: "subscriptions",
        topic: "subscription_review",
        title: "Cancel ClassPass",
        worthCents: last.amountCents * 12,
        worthKind: "saves",
        confidencePercent: 85,
        confidenceReason: "monthly, unused",
        urgency: "soon",
        why: "x",
        actionLabel: "Review subscriptions",
        actionHref: "/subscriptions",
        watch: {
          kind: "charge_stops",
          payees: [{ description: last.description, amountCents: last.amountCents, perYear: 12 }],
        },
      },
    });

    // Estimated: found, shown, not acted on. Not counted.
    await recordShown(
      userId,
      [
        {
          key: KEY,
          capability: "subscriptions",
          topic: "subscription_review",
          title: "Cancel ClassPass",
          worthCents: last.amountCents * 12,
          worthKind: "saves",
          confidencePercent: 85,
          watch: {
            kind: "charge_stops",
            payees: [{ description: last.description, amountCents: last.amountCents, perYear: 12 }],
          },
        },
      ],
      { client, now: at(addDays(lastDay, -5)) },
    );
    let ledger = await savingsLedger(userId, { client, now: NOW });
    const mine = () => ledger.entries.find((e) => e.key === KEY)!;
    expect(mine()).toMatchObject({ state: "estimated", confidencePercent: 85 });
    expect(ledger.savedCents).toBe(0);
    const othersEstimated = ledger.estimatedCents - last.amountCents * 12;

    // Done: "I did it", the day after the last charge.
    const doneDay = addDays(lastDay, 1);
    await markSuggestionDone(userId, KEY, { client, now: at(doneDay) });
    ledger = await savingsLedger(userId, { client, now: NOW });
    expect(mine().state).toBe("done");
    expect(ledger.savedCents).toBe(0);
    // Founder (10-30): "done, we'll check on <day>", the day it can first be verified: the
    // next charge's due day plus the bank's grace. On the ledger and in the chat's tool.
    const due = addDays(lastDay, 30);
    const checkDay = dayLabel(addDays(due, STOP_GRACE_DAYS + 1));
    ledger = await savingsLedger(userId, { client, now: at(doneDay) });
    expect(mine().checkWords).toBe(`we'll check on ${checkDay}`);
    const tool = JSON.parse(
      (await runChatTool(userId, "proven_savings", {}, { client, now: at(doneDay) })).content,
    ) as { estimates: { what: string; check?: string | null }[] };
    expect(tool.estimates.find((e) => e.what === "Cancel ClassPass")?.check).toBe(
      `we'll check on ${checkDay}`,
    );

    // Before the next charge was due (and its grace): still Done.
    await verifyOutcomes(userId, { client, now: at(addDays(due, STOP_GRACE_DAYS - 1)) });
    expect(
      (await savingsLedger(userId, { client, now: NOW })).entries.find((e) => e.key === KEY)!.state,
    ).toBe("done");

    // Verified: due and gone, and her statements reach past it. The last charge is the line.
    const verifiedDay = addDays(due, STOP_GRACE_DAYS + 2);
    await verifyOutcomes(userId, { client, now: at(verifiedDay) });
    ledger = await savingsLedger(userId, { client, now: NOW });
    expect(mine()).toMatchObject({ state: "verified", cents: last.amountCents * 12 });
    expect(mine().lines.map((l) => l.id)).toEqual([last.id]);
    expect(ledger.savedCents).toBe(last.amountCents * 12);
    // Out of the estimates, into the headline.
    expect(ledger.estimatedCents).toBe(othersEstimated);

    // A day short of the held window: still Verified.
    await verifyOutcomes(userId, { client, now: at(addDays(verifiedDay, HELD_DAYS - 1)) });
    expect(
      (await savingsLedger(userId, { client, now: NOW })).entries.find((e) => e.key === KEY)!.state,
    ).toBe("verified");

    // Held: still no charge HELD_DAYS later, on statements that reach that far.
    await verifyOutcomes(userId, { client, now: at(addDays(verifiedDay, HELD_DAYS)) });
    ledger = await savingsLedger(userId, { client, now: NOW });
    expect(mine()).toMatchObject({ state: "held", heldOn: addDays(verifiedDay, HELD_DAYS) });
    expect(mine().heldProof).toMatch(/^No charge since/);
    expect(mine().heldLines.map((l) => l.id)).toEqual([last.id]);
    expect(ledger.savedCents).toBe(last.amountCents * 12);
    expect(ledger.heldCents).toBe(last.amountCents * 12);

    // Every move, in order, to the audit log.
    expect(moves()).toEqual([
      ["suggestion_outcome", "estimated", "done"],
      ["suggestion_outcome", "done", "verified"],
      ["suggestion_outcome", "verified", "held"],
    ]);
  });
});

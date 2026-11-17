import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { PUT_AWAY_UNDO_MINUTES } from "@/config/put-away";
import { findingOfType } from "@/lib/__fixtures__/findings";
import { CARD_SELECT } from "@/lib/cards";
import { findingFingerprint } from "../snapshot";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
// The audit row goes through the app's own client, which a test run with no DATABASE_URL lacks.
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { takeChatAction } from ".";

// Debug 3 (11-16, re-walking #1964): "Don't suggest again" on a finding's card left no way back.
// Now it leaves "Bring it back" for PUT_AWAY_UNDO_MINUTES, which undoes the No (the finding is
// shown again) and deletes the "never" it saved, unless the person had said so before; on any of
// Jane's other cards it deletes the "never" and reopens the message. Twice is safe. Against a real
// Postgres.

const url = process.env.TEST_DATABASE_URL;
const sample = findingOfType("bank_fees");

describe.runIf(url)("Don't suggest again, brought back", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  let n = 0;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    userId = (
      await client.user.create({ data: { email: `never-${crypto.randomUUID()}@example.com` } })
    ).id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  // A finding, shown, and its card with the buttons a finding's card has.
  async function findingCard() {
    n += 1;
    const finding = await client.finding.create({
      data: {
        userId,
        type: sample.type,
        key: `${sample.key}-never-${n}`,
        title: sample.title,
        annualSavingsCents: sample.annualSavingsCents,
        amountCents: sample.amountCents,
        confidence: sample.confidence,
        evidence: sample.evidence as Prisma.InputJsonObject,
        status: "shown",
      },
      select: { ...CARD_SELECT, key: true },
    });
    const buttons = [
      { id: "finding.yes", label: "Yes", kind: "primary" },
      { id: "finding.no", label: "No", kind: "secondary" },
      { id: "suggest.never", label: "Don't suggest again", kind: "secondary" },
      { id: "open", label: "Open", kind: "link", href: `/report/${finding.id}` },
    ];
    const message = await client.janeMessage.create({
      data: {
        userId,
        kind: "decision",
        dedupeKey: `finding:${finding.id}`,
        body: `${sample.title}.`,
        status: "open",
        actions: buttons,
        refs: { findingId: finding.id, fingerprint: findingFingerprint(finding) },
      },
    });
    return { finding, id: message.id, buttons, never: `finding:${finding.key}` };
  }

  const tap = (id: string, action: string, now = new Date()) =>
    takeChatAction(userId, id, action, { client, now });
  const codeOf = (p: Promise<unknown>) =>
    p.then(
      () => "ran",
      (e: { code?: string }) => e.code ?? String(e),
    );
  const nevers = (key: string) =>
    client.janePreference.count({ where: { userId, kind: "never", key } });
  const statusOf = async (findingId: string) =>
    (await client.finding.findUniqueOrThrow({ where: { id: findingId } })).status;
  const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);

  it("a finding's card: the No undone and the never deleted, minutes later, and twice is safe", async () => {
    const card = await findingCard();
    await tap(card.id, "suggest.never");
    expect(await statusOf(card.finding.id)).toBe("declined");
    expect(await nevers(card.never)).toBe(1);
    const away = await client.janeMessage.findUniqueOrThrow({ where: { id: card.id } });
    expect((away.actions as { id: string }[])[0].id).toBe("undo.suggest_never");

    // Five minutes on: long past the chat's ten-second Undo, well inside the card's way back.
    await tap(card.id, "undo.suggest_never", later(5));
    expect(await statusOf(card.finding.id)).toBe("shown");
    expect(await nevers(card.never)).toBe(0);
    const decision = await client.decision.findFirstOrThrow({
      where: { findingId: card.finding.id },
    });
    expect(decision.undoneAt).not.toBeNull();
    const back = await client.janeMessage.findUniqueOrThrow({ where: { id: card.id } });
    expect(back.status).toBe("open");
    expect(back.actions).toEqual(card.buttons);
    expect(back.refs).toEqual({
      findingId: card.finding.id,
      fingerprint: findingFingerprint(card.finding),
    });
    expect(await codeOf(tap(card.id, "undo.suggest_never", later(6)))).toBe("not_open");
  });

  it("keeps a never the person had said before", async () => {
    const card = await findingCard();
    await client.janePreference.create({
      data: { userId, kind: "never", key: card.never, value: {}, label: "Don't suggest: fees" },
    });
    await tap(card.id, "suggest.never");
    await tap(card.id, "undo.suggest_never", later(1));
    expect(await nevers(card.never)).toBe(1);
    expect(await statusOf(card.finding.id)).toBe("shown");
  });

  it("another of Jane's cards: open again, the never deleted", async () => {
    n += 1;
    const buttons = [
      { id: "alert.got_it", label: "Got it", kind: "primary" },
      { id: "suggest.never", label: "Don't suggest again", kind: "secondary" },
    ];
    const message = await client.janeMessage.create({
      data: {
        userId,
        kind: "heads_up",
        dedupeKey: `alert:never-${n}`,
        body: "A new fee on your checking.",
        status: "open",
        actions: buttons,
        refs: {},
      },
    });
    await tap(message.id, "suggest.never");
    expect(await nevers(`message:alert:never-${n}`)).toBe(1);
    await tap(message.id, "undo.suggest_never", later(2));
    expect(await nevers(`message:alert:never-${n}`)).toBe(0);
    const back = await client.janeMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect([back.status, back.actions]).toEqual(["open", buttons]);
  });

  it("is too late once the window has passed", async () => {
    const card = await findingCard();
    await tap(card.id, "suggest.never");
    expect(await codeOf(tap(card.id, "undo.suggest_never", later(PUT_AWAY_UNDO_MINUTES + 1)))).toBe(
      "expired",
    );
    expect(await statusOf(card.finding.id)).toBe("declined");
  });
});

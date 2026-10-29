import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { ShareCardArt } from "@/components/share-card-art";
import { SHARE_INVITE_MAX_USES, SHARE_INVITE_NOTE } from "@/config/share";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { deleteAllData } from "@/lib/account-deletion";
import { generateCode, redeemInvite } from "@/lib/invites";
import { cardHeadline } from "@/lib/share-card";
import { currentCard } from "@/lib/share-current";
import {
  inviteFunnel,
  inviteLanding,
  recordInviteJoined,
  recordInviteOpened,
  recordInviteSent,
  shareLinkFor,
} from "./share-invites";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

const FOUND = { kind: "found" as const, dollars: 1200 };
const CHECKED = { kind: "checked" as const, checks: 9 };

// What the person has that must never reach the card.
const PRIVATE = {
  account: "Chase Total Checking",
  mask: "4417",
  balanceCents: 8_765_43,
  merchant: "NETFLIX.COM",
  finding: "Netflix Premium",
};

describe.runIf(url)("share links against a real database", () => {
  let client: PrismaClient;
  const users: string[] = [];
  const emails: string[] = [];

  async function person(prefix = "share") {
    const id = `${prefix}${crypto.randomUUID().replaceAll("-", "")}`;
    const email = `${id}@example.test`;
    await client.user.create({ data: { id, email } });
    users.push(id);
    emails.push(email);
    return id;
  }

  // An account with a few months of a charge, and a finding about it.
  async function withMoney(userId: string, annualSavingsCents: number | null) {
    const account = await client.account.create({
      data: {
        userId,
        source: "csv",
        name: PRIVATE.account,
        mask: PRIVATE.mask,
        type: "depository",
        subtype: "checking",
        currentBalanceCents: PRIVATE.balanceCents,
      },
    });
    for (let month = 0; month < 4; month += 1) {
      await client.transaction.create({
        data: {
          userId,
          accountId: account.id,
          source: "csv",
          date: new Date(Date.UTC(2026, 6 + month, 3)),
          amountCents: 22_99,
          description: PRIVATE.merchant,
        },
      });
    }
    if (annualSavingsCents !== null) {
      await client.finding.create({
        data: {
          userId,
          type: "bank_fees",
          key: "merchant:netflix",
          title: PRIVATE.finding,
          confidence: "high",
          annualSavingsCents,
          evidence: { merchant: PRIVATE.merchant, account: PRIVATE.account },
        },
      });
    }
  }

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });

  beforeEach(() => {
    vi.mocked(track).mockReset();
    vi.mocked(logAudit).mockReset();
  });

  afterAll(async () => {
    await client.inviteCode.deleteMany({
      where: { OR: [{ sharedById: { in: users } }, { createdById: { in: users } }] },
    });
    await client.betaAccess.deleteMany({ where: { email: { in: emails } } });
    await client.user.deleteMany({ where: { id: { in: users } } });
    await client.analyticsEvent.deleteMany({ where: { name: { startsWith: "invite_" } } });
    await client.$disconnect();
  });

  it("works out the card from the person's own numbers", async () => {
    const rich = await person();
    await withMoney(rich, 1_234_56);
    expect(await currentCard(rich, { client })).toEqual(FOUND);

    const fine = await person();
    await withMoney(fine, null);
    const card = await currentCard(fine, { client });
    expect(card?.kind).toBe("checked");
    expect(card && card.kind === "checked" && card.checks).toBeGreaterThan(0);
  });

  it("gives each person one invite code, reused and showing their latest card", async () => {
    const id = await person();
    const first = await shareLinkFor(id, FOUND, { client });
    expect(first?.path).toBe(`/join/${first?.code}`);
    expect(logAudit).toHaveBeenCalledWith({ type: "user", id }, "invite_code_created", {
      type: "invite_code",
      id: expect.any(String),
    });

    const again = await shareLinkFor(id, CHECKED, { client });
    expect(again?.code).toBe(first?.code);
    expect(logAudit).toHaveBeenCalledTimes(1);

    const row = await client.inviteCode.findUniqueOrThrow({ where: { sharedById: id } });
    expect(row).toMatchObject({
      maxUses: SHARE_INVITE_MAX_USES,
      note: SHARE_INVITE_NOTE,
      cardKind: "checked",
      cardValue: 9,
    });
  });

  it("never shares for a trial person, or once the team revoked the code", async () => {
    const trial = await person("trial_");
    expect(await shareLinkFor(trial, FOUND, { client })).toBeNull();
    expect(await client.inviteCode.count({ where: { sharedById: trial } })).toBe(0);
    expect(await recordInviteSent(trial, "copy", { client })).toBe(false);

    const id = await person();
    await shareLinkFor(id, FOUND, { client });
    await client.inviteCode.update({ where: { sharedById: id }, data: { revokedAt: new Date() } });
    expect(await shareLinkFor(id, FOUND, { client })).toBeNull();
  });

  // The privacy rule, end to end: a person with a named account, a balance, a merchant and a
  // finding shares; the stored code, the page's data and the drawn card hold only the number.
  it("puts nothing but the rounded total on the card", async () => {
    const id = await person();
    await withMoney(id, 1_234_56);
    const link = await shareLinkFor(id, (await currentCard(id, { client }))!, { client });
    const landing = await inviteLanding(link!.code, { client });
    const drawn = renderToStaticMarkup(<ShareCardArt card={landing!.card} />);
    const stored = JSON.stringify(
      await client.inviteCode.findUniqueOrThrow({
        where: { sharedById: id },
        select: { note: true, cardKind: true, cardValue: true },
      }),
    );

    for (const text of [JSON.stringify(landing), drawn, stored, cardHeadline(landing!.card!)]) {
      for (const secret of [
        PRIVATE.account,
        "Chase",
        PRIVATE.mask,
        PRIVATE.merchant,
        "Netflix",
        PRIVATE.finding,
        "8,765",
        "1,234",
        id,
      ]) {
        expect(text, secret).not.toContain(secret);
      }
    }
    expect(drawn).toContain("$1,200/yr");
  });

  it("opens only share codes, and says when one is used up", async () => {
    const id = await person();
    const link = await shareLinkFor(id, FOUND, { client });
    expect(await inviteLanding(link!.code.toLowerCase(), { client })).toMatchObject({
      code: link!.code,
      card: FOUND,
      open: true,
    });

    await client.inviteCode.update({
      where: { sharedById: id },
      data: { uses: SHARE_INVITE_MAX_USES },
    });
    expect((await inviteLanding(link!.code, { client }))?.open).toBe(false);

    const team = await client.inviteCode.create({
      data: { code: generateCode(), maxUses: 5, createdById: id },
    });
    expect(await inviteLanding(team.code, { client })).toBeNull();
    expect(await inviteLanding("not a code", { client })).toBeNull();
  });

  it("counts sent, opened (not link previews) and joined", async () => {
    const id = await person();
    const link = await shareLinkFor(id, FOUND, { client });
    const inviteId = (await inviteLanding(link!.code, { client }))!.inviteId;

    expect(await recordInviteSent(id, "share_sheet", { client })).toBe(true);
    expect(track).toHaveBeenCalledWith(id, "invite_sent", {
      invite_id: inviteId,
      method: "share_sheet",
      card: "found",
    });

    expect(
      await recordInviteOpened(inviteId, "facebookexternalhit/1.1 Facebot Twitterbot/1.0"),
    ).toBe(false);
    expect(await recordInviteOpened(inviteId, null)).toBe(false);
    expect(await recordInviteOpened(inviteId, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)")).toBe(
      true,
    );
    expect(track).toHaveBeenCalledWith(null, "invite_opened", { invite_id: inviteId });

    const friend = `friend-${crypto.randomUUID()}@example.test`;
    emails.push(friend);
    expect(await redeemInvite(link!.code, friend, { client })).toBe("ok");
    const friendId = await person();
    expect(await recordInviteJoined(friendId, friend.toUpperCase(), { client })).toBe(true);
    expect(track).toHaveBeenCalledWith(friendId, "invite_joined", {
      invite_id: inviteId,
      sharer_id: id,
    });
  });

  it("doesn't count a join from the team's own codes", async () => {
    const id = await person();
    const code = await client.inviteCode.create({
      data: { code: generateCode(), maxUses: 5, createdById: id },
    });
    const friend = `team-${crypto.randomUUID()}@example.test`;
    emails.push(friend);
    expect(await redeemInvite(code.code, friend, { client })).toBe("ok");
    expect(await recordInviteJoined(await person(), friend, { client })).toBe(false);
    expect(track).not.toHaveBeenCalledWith(expect.anything(), "invite_joined", expect.anything());
  });

  it("adds up the funnel, leaving trial people out", async () => {
    const before = await inviteFunnel({ client });
    const id = await person();
    const trial = await person("trial_");
    await client.analyticsEvent.createMany({
      data: [
        { userId: id, name: "invite_sent" },
        { userId: id, name: "invite_sent" },
        { userId: null, name: "invite_opened" },
        { userId: id, name: "invite_joined" },
        { userId: trial, name: "invite_sent" },
      ],
    });
    expect(await inviteFunnel({ client })).toEqual({
      sent: before.sent + 2,
      opened: before.opened + 1,
      joined: before.joined + 1,
    });
  });

  it("stops the link and forgets the card when the person deletes their data", async () => {
    const id = await person();
    const link = await shareLinkFor(id, FOUND, { client });
    await deleteAllData(id, { client, api: {} as PlaidApi });
    expect(await inviteLanding(link!.code, { client })).toBeNull();
    const row = await client.inviteCode.findUniqueOrThrow({ where: { code: link!.code } });
    expect(row).toMatchObject({ sharedById: null, cardKind: null, cardValue: null });
    expect(row.revokedAt).not.toBeNull();
    await client.inviteCode.delete({ where: { id: row.id } });
  });
});

import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { setAutopilot } from "@/lib/autopilot";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import {
  PropertyTaxError,
  chooseFiler,
  draftPropertyAppeal,
  loadPropertyTax,
  markClaimed,
  savePropertyAnswers,
} from "@/lib/property-tax";
import { runTaxAutopilot } from "@/lib/tax-autopilot";
import { takeChatAction } from "./actions";
import { runChatTool } from "./claude-tools";
import { loadSnapshot } from "./snapshot";
import { taxesSource } from "./sources/taxes";
import { sendToJane } from "./typing";

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const context = { now: LINKED, local: { date: "2026-10-18", hour: 8 }, trigger: "open" as const };

describe.runIf(url)("property tax against a real database", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("no plaid");
      },
    },
  ) as PlaidApi;
  async function person(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    return user.id;
  }
  const messageFrom = async (userId: string, key: string, variant = "") => {
    const c = taxesSource
      .gather((await loadSnapshot(userId, { client, now: LINKED }))!, context)
      .find((x) => x.dedupeKey.startsWith(key));
    if (!c) return null;
    return client.janeMessage.create({
      data: {
        userId,
        kind: c.kind,
        body: c.body,
        refs: c.refs,
        actions: c.actions,
        dedupeKey: `taxes:${c.dedupeKey}${variant}`,
      },
    });
  };
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

  it("compares the stand-in record, suggests an appeal over the threshold, and drafts it with the comparables", async () => {
    const userId = await person("prop");
    const v = await loadPropertyTax(userId, { client, now: LINKED });
    expect(v).toMatchObject({ advice: true, state: "CA", figuresFrom: "partner", suggested: true });
    expect(v.gap!.gapRate).toBeCloseTo(0.14);
    expect(v.comps).toHaveLength(3);
    expect(v.window).toMatchObject({ status: "open", closesOn: "2026-11-30" });

    // The suggestion is a message with a button; nothing is drafted or filed yet.
    const suggestion = (await messageFrom(userId, "property:"))!;
    expect(suggestion.body).toMatch(
      /^Your home is assessed at \$[\d,]+, about 14% above the \$[\d,]+ that recent sales of comparable homes point to\./,
    );
    expect(suggestion.body).toContain(
      "You can appeal to the county Assessment Appeals Board until Nov 30, 2026.",
    );
    expect(await client.propertyAppeal.count({ where: { userId } })).toBe(0);

    const done = (
      await takeChatAction(userId, suggestion.id, "tax.property_draft", { client, now: LINKED })
    ).message;
    expect(done.refs.note).toMatch(
      /^Done: your appeal is drafted \(about \$[\d,]+ a year if it works\) and the deadline is on your plan\./,
    );
    const appeal = await client.propertyAppeal.findFirstOrThrow({ where: { userId } });
    expect(appeal).toMatchObject({ status: "drafted", year: 2026 });
    expect(appeal.draft).toContain("sample sale");
    expect(
      await client.deadline.count({
        where: { userId, title: "Appeal your 2026 property tax assessment" },
      }),
    ).toBe(1);
    await expect(draftPropertyAppeal(userId, { client, now: LINKED, via: "page" })).rejects.toThrow(
      "already drafted",
    );

    // Who files it is the person's tap; the record says who, and Jane files nothing.
    const filer = (await messageFrom(userId, "property_filer:"))!;
    expect(filer.body).toContain("I file nothing myself");
    const handled = (
      await takeChatAction(userId, filer.id, "tax.property_team", { client, now: LINKED })
    ).message;
    expect(handled.refs.note).toBe(
      "Done: my team has your appeal to file. I'll tell you when it's in.",
    );
    expect((await client.propertyAppeal.findFirstOrThrow({ where: { userId } })).status).toBe(
      "team",
    );
    await expect(chooseFiler(userId, "you", { client, now: LINKED })).rejects.toThrow(
      "Draft the appeal first",
    );
  });

  it("suggests nothing when the gap is under the threshold, or after the window closes", async () => {
    const userId = await person("prop-small");
    await savePropertyAnswers(
      userId,
      {
        marketCents: 50_000_000,
        assessedCents: 52_000_000,
        assessedYear: 2026,
        noticeOn: null,
        age: null,
        veteran: null,
        disabled: null,
      },
      { client, now: LINKED, via: "page" },
    );
    const small = await loadPropertyTax(userId, { client, now: LINKED });
    expect(small).toMatchObject({ figuresFrom: "you", suggested: false });
    expect(small.gap!.gapRate).toBeCloseTo(0.04);
    expect(await messageFrom(userId, "property:")).toBeNull();
    await expect(
      draftPropertyAppeal(userId, { client, now: LINKED, via: "page" }),
    ).rejects.toBeInstanceOf(PropertyTaxError);

    // A big gap, but the window closed: California's closed on Nov 30.
    await savePropertyAnswers(
      userId,
      {
        marketCents: 50_000_000,
        assessedCents: 60_000_000,
        assessedYear: 2026,
        noticeOn: null,
        age: null,
        veteran: null,
        disabled: null,
      },
      { client, now: LINKED, via: "page" },
    );
    const late = new Date("2026-12-15T15:00:00Z");
    expect((await loadPropertyTax(userId, { client, now: LINKED })).suggested).toBe(true);
    const next = await loadPropertyTax(userId, { client, now: late });
    expect(next.window).toMatchObject({ status: "upcoming", opensOn: "2027-07-02" });
  });

  it("checks what's told, and names exemptions not yet claimed", async () => {
    const userId = await person("prop-exempt");
    const none = {
      marketCents: null,
      assessedCents: null,
      assessedYear: null,
      noticeOn: null,
      age: null,
      veteran: null,
      disabled: null,
    };
    await expect(
      savePropertyAnswers(
        userId,
        { ...none, marketCents: -5 },
        { client, now: LINKED, via: "page" },
      ),
    ).rejects.toBeInstanceOf(PropertyTaxError);
    await expect(
      savePropertyAnswers(
        userId,
        { ...none, noticeOn: "2027-01-01" },
        { client, now: LINKED, via: "page" },
      ),
    ).rejects.toThrow("today or earlier");
    await expect(
      savePropertyAnswers(userId, { ...none, age: 5 }, { client, now: LINKED, via: "page" }),
    ).rejects.toThrow("18 to 120");

    const first = (await loadPropertyTax(userId, { client, now: LINKED })).exemptions;
    expect(first.eligible.map((e) => e.key)).toEqual(["ca_homeowners"]);
    expect(first.ask).toContain(
      "your age".replace("your age", "whether you served in the military"),
    );
    const message = (await messageFrom(userId, "exemption:"))!;
    expect(message.body).toContain("You may qualify for the Homeowners' Exemption on your home.");

    const reminded = (
      await takeChatAction(userId, message.id, "tax.exemption_remind", { client, now: LINKED })
    ).message;
    expect(reminded.refs.note).toBe(
      "Done: applying for the Homeowners' Exemption is on your deadlines.",
    );
    expect(
      await client.deadline.count({
        where: { userId, title: "Apply for the Homeowners' Exemption" },
      }),
    ).toBe(1);

    await savePropertyAnswers(
      userId,
      { ...none, veteran: true, disabled: true },
      { client, now: LINKED, via: "page" },
    );
    expect(
      (await loadPropertyTax(userId, { client, now: LINKED })).exemptions.eligible.map(
        (e) => e.key,
      ),
    ).toEqual(["ca_homeowners", "ca_veteran", "ca_disabled_veteran"]);
    const again = (await messageFrom(userId, "exemption:", ":again"))!;
    const claimed = (
      await takeChatAction(userId, again.id, "tax.exemption_claimed", { client, now: LINKED })
    ).message;
    expect(claimed.refs.note).toBe("Good, I won't bring that one up again.");
    expect(
      (await loadPropertyTax(userId, { client, now: LINKED })).exemptions.eligible.map(
        (e) => e.key,
      ),
    ).not.toContain("ca_homeowners");
    await expect(markClaimed(userId, ["nope"], { client, now: LINKED })).rejects.toThrow(
      "isn't on your list",
    );
  });

  it("puts the deadline on the plan by itself at Handle the safe stuff, once", async () => {
    const userId = await person("prop-auto");
    expect((await runTaxAutopilot(userId, { client, now: LINKED })).propertyReminded).toBe(false);
    await setAutopilot(userId, "safe", { client, now: LINKED });
    expect((await runTaxAutopilot(userId, { client, now: LINKED })).propertyReminded).toBe(true);
    expect((await runTaxAutopilot(userId, { client, now: LINKED })).propertyReminded).toBe(false);
    expect(
      await client.deadline.count({
        where: { userId, title: "Appeal your 2026 property tax assessment" },
      }),
    ).toBe(1);
    // Nothing is drafted or filed on its own.
    expect(await client.propertyAppeal.count({ where: { userId } })).toBe(0);
  });

  it("answers in the chat and to Claude", async () => {
    const userId = await person("prop-chat");
    const { reply } = await sendToJane(userId, "is my property tax too high", {
      client,
      now: LINKED,
    });
    expect(reply.body).toMatch(
      /^Here is how your property tax looks\.\n• Assessed at \$[\d,.]+ against a market value of \$[\d,.]+ \(sample data\): 14% over\./,
    );
    expect(reply.body).toContain("That's worth appealing");
    const tool = JSON.parse(
      (await runChatTool(userId, "tax_property", {}, { client, now: LINKED })).content,
    );
    expect(tool.worthAppealing).toBe(true);
    expect(tool.comparableSales).toHaveLength(3);
    expect(tool.appealWindow.closes).toBe("2026-11-30");
  });
});

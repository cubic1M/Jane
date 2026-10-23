import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/insurance/need/pick", async (original) => ({
  ...(await original<typeof import("@/lib/insurance/need/pick")>()),
  pickOption: vi.fn(),
}));
// Self-contained: loading the real module here would load this file's subject before the mock.
vi.mock("@/lib/insurance/accept", () => ({
  AcceptShopError: class AcceptShopError extends Error {},
  acceptShop: vi.fn(),
  insuranceSwitchOf: vi.fn(() => null),
}));
vi.mock("@/lib/fit-pick", async (original) => ({
  ...(await original<typeof import("@/lib/fit-pick")>()),
  pickFitOption: vi.fn(),
}));

import type { PrismaClient } from "@/generated/prisma/client";
import { FitPickError, pickFitOption } from "@/lib/fit-pick";
import { AcceptShopError, acceptShop } from "@/lib/insurance/accept";
import { PickError, pickOption } from "@/lib/insurance/need/pick";
import type { OfferedOptions } from "@/lib/option-card";
import type { ChatMessage } from "../types";
import { ChatActionError } from "./handler";
import { ACTION_HANDLERS } from "./index";
import { OPTION_ACTIONS, optionLater, optionPick } from "./options";

// The pick-one card's buttons: option.pick carries the option's id, which must be one the
// message offered, and goes through the card's own lane's picker; option.later puts it off.

const client = {} as PrismaClient;
const now = new Date("2026-10-18T15:00:00Z");

const card = (kind: "insurance" | "loan", over: Partial<OfferedOptions> = {}): OfferedOptions => ({
  kind,
  title: "Choose your life cover",
  topic: kind === "insurance" ? "life" : "car:2500000",
  newCover: true,
  advice: true,
  options: [
    {
      id: "o1",
      label: "Lighthouse (rated A)",
      headline: "Lighthouse, $480.00 a year",
      priceCents: 48_000,
      pricePeriod: "year",
      facts: [],
      whyThisOne: "The least for the cover you need.",
      isPick: true,
      details: [],
    },
    {
      id: "o2",
      label: "Harbor (rated A-)",
      headline: "Harbor, $520.00 a year",
      priceCents: 52_000,
      pricePeriod: "year",
      facts: [],
      whyThisOne: "Higher rated insurer.",
      isPick: false,
      details: [],
    },
  ],
  ...over,
});

const message = (options?: OfferedOptions): ChatMessage => ({
  id: "m1",
  kind: "reply",
  body: "You need about $500,000 of term life.",
  refs: options ? { options, advice: true } : {},
  actions: OPTION_ACTIONS,
  status: "open",
  answeredWith: null,
  answeredAt: null,
  createdAt: now,
});

const run = (handler: typeof optionPick, m: ChatMessage, choice?: string) =>
  handler.run({ userId: "u1", message: m, action: OPTION_ACTIONS[0], client, now, choice });

beforeEach(() => {
  vi.mocked(pickOption).mockReset();
  vi.mocked(pickFitOption).mockReset();
  vi.mocked(acceptShop).mockReset();
});

describe("option.pick", () => {
  it("is registered, with option.later, on open messages", () => {
    expect(ACTION_HANDLERS["option.pick"]).toBe(optionPick);
    expect(ACTION_HANDLERS["option.later"]).toBe(optionLater);
    expect(optionPick.on).toBe("open");
    expect(OPTION_ACTIONS.map((a) => a.id)).toEqual(["option.pick", "option.later"]);
  });

  it("queues an insurance pick through pickOption, with the policy the need is about", async () => {
    vi.mocked(pickOption).mockResolvedValue({ decisionId: "d1", actionId: "a1", newCover: false });
    const outcome = await run(optionPick, message(card("insurance", { policyId: "p1" })), "o2");
    expect(pickOption).toHaveBeenCalledWith("u1", "life", "o2", { client, now, policyId: "p1" });
    expect(pickFitOption).not.toHaveBeenCalled();
    expect(outcome.answeredWith).toBe("Harbor (rated A-)");
    expect(outcome.note).toMatch(/change that on your policy/);
  });

  it("says new cover is added when there was none", async () => {
    vi.mocked(pickOption).mockResolvedValue({ decisionId: "d1", actionId: "a1", newCover: true });
    const outcome = await run(optionPick, message(card("insurance")), "o1");
    expect(pickOption).toHaveBeenCalledWith("u1", "life", "o1", { client, now });
    expect(outcome.note).toMatch(/add that cover/);
  });

  it("queues a loan pick through pickFitOption with the card's topic", async () => {
    vi.mocked(pickFitOption).mockResolvedValue({ decisionId: "d1", actionId: "a1", kept: false });
    const outcome = await run(optionPick, message(card("loan")), "o1");
    expect(pickFitOption).toHaveBeenCalledWith("u1", "car:2500000", "o1", { client, now });
    expect(outcome.note).toMatch(/lender's steps/);
  });

  it("refuses an option the message never offered, or a message with no options", async () => {
    await expect(run(optionPick, message(card("insurance")), "made-up")).rejects.toMatchObject({
      code: "not_offered",
    });
    await expect(run(optionPick, message(card("insurance")))).rejects.toBeInstanceOf(
      ChatActionError,
    );
    await expect(run(optionPick, message(), "o1")).rejects.toMatchObject({ code: "not_offered" });
    expect(pickOption).not.toHaveBeenCalled();
  });

  it("passes on the picker's refusal (stale, or already with the team) in its own words", async () => {
    vi.mocked(pickOption).mockRejectedValue(new PickError("You've already picked this one."));
    await expect(run(optionPick, message(card("insurance")), "o1")).rejects.toMatchObject({
      code: "not_open",
      message: "You've already picked this one.",
    });
    vi.mocked(pickFitOption).mockRejectedValue(new FitPickError("That option isn't available."));
    await expect(run(optionPick, message(card("loan")), "o1")).rejects.toMatchObject({
      code: "not_open",
    });
  });
});

describe("option.pick on a reshop's quotes", () => {
  it("switches to the picked quote through acceptShop and starts the agent", async () => {
    vi.mocked(acceptShop).mockResolvedValue({ decisionId: "d1", actionId: "a1", agentJobId: "j1" });
    const outcome = await run(
      optionPick,
      message(card("insurance", { topic: "switch:shop1" })),
      "o2",
    );
    expect(acceptShop).toHaveBeenCalledWith("u1", "shop1", { client, now, quoteId: "o2" });
    expect(pickOption).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ answeredWith: "Harbor (rated A-)", agentJobIds: ["j1"] });
    expect(outcome.note).toMatch(/^Done\. I'm switching you now/);
  });

  it("says why when the quote can't be switched to any more", async () => {
    vi.mocked(acceptShop).mockRejectedValue(new AcceptShopError("These quotes have expired."));
    await expect(
      run(optionPick, message(card("insurance", { topic: "switch:shop1" })), "o1"),
    ).rejects.toMatchObject({ code: "not_open", message: "These quotes have expired." });
  });
});

describe("option.later", () => {
  it("puts the whole set off, keeping the message in the history", async () => {
    const outcome = await run(optionLater, message(card("insurance")));
    expect(outcome.status).toBe("dismissed");
    expect(outcome.answeredWith).toBeNull();
    expect(pickOption).not.toHaveBeenCalled();
  });
});

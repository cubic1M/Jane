import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
import { mailMode, replyAddress, tokenFromAddress } from "./mail";
import { readReply, readReplyByRules } from "./read-reply";
import {
  isSimulatedAddress,
  simulatedAddress,
  simulatedBody,
  simulatedKind,
  type SimulatedKind,
} from "./simulated-company";

describe("agent mail", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("puts the action's token in the reply-to address and reads it back", () => {
    vi.stubEnv("AGENT_INBOUND_DOMAIN", "reply.jane.app");
    const token = "a1".repeat(16);
    expect(replyAddress(token)).toBe(`reply+${token}@reply.jane.app`);
    expect(tokenFromAddress(`Jane <reply+${token}@reply.jane.app>`)).toBe(token);
    expect(tokenFromAddress("someone@example.com")).toBeNull();
  });

  it("sends real email only when it's set up, and never simulates in production", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("NODE_ENV", "test");
    expect(mailMode()).toBe("simulated");
    vi.stubEnv("NODE_ENV", "production");
    expect(mailMode()).toBe("off");
    vi.stubEnv("RESEND_API_KEY", "key");
    vi.stubEnv("EMAIL_FROM", "Jane <agent@jane.app>");
    vi.stubEnv("AGENT_INBOUND_DOMAIN", "reply.jane.app");
    expect(mailMode()).toBe("email");
  });
});

describe("reading replies", () => {
  it.each([
    ["Your refund has been processed for the charges listed.", "done"],
    ["We can keep your previous price for the next 12 months.", "done"],
    ["Unfortunately we are unable to offer a refund.", "refused"],
    ["Could you confirm the last 4 digits of the card?", "needs_info"],
    ["The account holder must contact us directly.", "needs_person"],
    ["Thanks, we got your message.", "unclear"],
  ])("reads %j as %s without Claude", (body, outcome) => {
    expect(readReplyByRules(body).outcome).toBe(outcome);
  });

  // Gap audit: the stand-in answered a cancellation with "unable to offer a refund".
  it("answers each kind of request in its own words, and the rules read each one", () => {
    for (const [type, done, refused] of [
      ["cancel_subscription", /cancelled the subscription/, /unable to cancel/],
      ["negotiate_bill", /lower rate/, /unable to change the price/],
      ["request_refund", /refund has been processed/, /unable to offer a refund/],
    ] as const) {
      const yes = simulatedBody("done", type, "Hulu");
      const no = simulatedBody("refused", type, "Hulu");
      expect(yes, type).toMatch(done);
      expect(no, type).toMatch(refused);
      expect(readReplyByRules(yes).outcome, type).toBe("done");
      expect(readReplyByRules(no).outcome, type).toBe("refused");
    }
  });

  it("sums up a reply with the sentence that says what happened", () => {
    expect(readReplyByRules(simulatedBody("done", "request_refund", "Target")).summary).toBe(
      "Your refund has been processed for the charges listed.",
    );
    expect(readReplyByRules(simulatedBody("needs_info", "request_refund", "Target"))).toMatchObject(
      {
        question:
          "Could you confirm the last 4 digits of the card that was charged, so we can find the account?",
      },
    );
  });

  it("uses Claude's reading when it fits, and the word rules when it doesn't", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const answer = (text: string) => ({
      messages: {
        create: vi.fn(async () => ({
          stop_reason: "end_turn",
          content: [{ type: "text", text }],
        })),
      },
    });
    const good = await readReply(
      { subject: "Re: refund", body: "Done, refunded." },
      {
        client: () =>
          answer(
            JSON.stringify({ outcome: "done", summary: "They refunded it.", question: "" }),
          ) as never,
      },
    );
    expect(good).toMatchObject({ outcome: "done", source: "llm", question: null });
    const bad = await readReply(
      { subject: "Re", body: "We are unable to help." },
      { client: () => answer(JSON.stringify({ outcome: "maybe", summary: "" })) as never },
    );
    expect(bad).toMatchObject({ outcome: "refused", source: "rules" });
    vi.unstubAllEnvs();
  });
});

describe("the simulated company", () => {
  it("has its own addresses, never a real company's", () => {
    expect(simulatedAddress("Target")).toBe("support@target.simulated-support.example");
    expect(isSimulatedAddress(simulatedAddress("Netflix"))).toBe(true);
    expect(isSimulatedAddress("support@netflix.com")).toBe(false);
  });

  it("writes replies the agent reads the way they're meant", () => {
    for (const kind of ["done", "needs_info", "refused", "needs_person"] as SimulatedKind[]) {
      for (const type of ["request_refund", "fight_price_increase"] as const) {
        expect(readReplyByRules(simulatedBody(kind, type, "Target")).outcome).toBe(kind);
      }
    }
  });

  it("answers the same way for the same action, and goes ahead after an answer", () => {
    expect(simulatedKind("action-1", 1)).toBe(simulatedKind("action-1", 1));
    expect(simulatedKind("action-1", 2)).toBe("done");
    const kinds = new Set(Array.from({ length: 60 }, (_, i) => simulatedKind(`a${i}`, 1)));
    expect(kinds).toEqual(new Set(["done", "needs_info", "refused", "needs_person"]));
  });
});

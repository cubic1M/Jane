import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent/run", () => ({ handleReply: vi.fn(async () => "acted") }));

import { handleReply } from "@/lib/agent/run";
import { POST } from "./route";

// A company's reply counts as theirs only when the mail provider says DMARC passed: the From line is
// the sender's own to write. Resend's webhook is signed, and the email is read back from Resend.

const SECRET = `whsec_${Buffer.from("inbound-test-key").toString("base64")}`;
const TOKEN = "a".repeat(32);

function signed(event: unknown, secret = SECRET) {
  const body = JSON.stringify(event);
  const id = "msg_1";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return POST(
    new Request("https://app.example.com/api/agent/inbound", {
      method: "POST",
      headers: { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${signature}` },
      body,
    }),
  );
}

const received = (dmarc: string) => ({
  object: "email",
  id: "em_1",
  to: [`reply+${TOKEN}@agent.jane.test`],
  from: "Support <support@company.example>",
  subject: "Re: your request",
  text: "We've refunded the charge.",
  authentication: { spf: "pass", dkim: "pass", dmarc },
});

describe("a company's reply, by whether its sender was verified", () => {
  beforeEach(() => {
    vi.stubEnv("AGENT_INBOUND_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.mocked(handleReply).mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reads Resend's email back, and passes DMARC's verdict to the agent", async () => {
    for (const [dmarc, verified] of [
      ["pass", true],
      ["fail", false],
      ["none", false],
    ] as const) {
      const fetcher = vi.fn(async () => Response.json(received(dmarc)));
      vi.stubGlobal("fetch", fetcher);
      const response = await signed({ type: "email.received", data: { email_id: "em_1" } });
      expect(response.status).toBe(200);
      expect(String((fetcher.mock.calls[0] as unknown[])[0])).toBe(
        "https://api.resend.com/emails/receiving/em_1",
      );
      expect(vi.mocked(handleReply).mock.lastCall).toEqual([
        `reply+${TOKEN}@agent.jane.test`,
        {
          from: "Support <support@company.example>",
          subject: "Re: your request",
          body: "We've refunded the charge.",
          verified,
        },
      ]);
    }
  });

  it("refuses a webhook not signed with the inbound secret, and reads nothing", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const other = `whsec_${Buffer.from("someone-else").toString("base64")}`;
    const response = await signed({ type: "email.received", data: { email_id: "em_1" } }, other);
    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
    expect(handleReply).not.toHaveBeenCalled();
  });

  it("asks Resend to send it again when the email can't be read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 500 })),
    );
    const response = await signed({ type: "email.received", data: { email_id: "em_1" } });
    expect(response.status).toBe(503);
    expect(handleReply).not.toHaveBeenCalled();
  });

  it("takes a forwarding provider's own DMARC result, and nothing claims to be verified unasked", async () => {
    vi.stubEnv("AGENT_INBOUND_SECRET", "s3cret");
    const forward = (extra: object) =>
      POST(
        new Request("https://app.example.com/api/agent/inbound", {
          method: "POST",
          headers: { authorization: "Bearer s3cret" },
          body: JSON.stringify({
            to: `reply+${TOKEN}@agent.jane.test`,
            from: "support@company.example",
            subject: "Re",
            text: "Refunded.",
            ...extra,
          }),
        }),
      );
    await forward({ authentication: { dmarc: "pass" } });
    expect(vi.mocked(handleReply).mock.lastCall?.[1]).toMatchObject({ verified: true });
    await forward({ verified: true, authentication: { dmarc: "fail" } });
    expect(vi.mocked(handleReply).mock.lastCall?.[1]).toMatchObject({ verified: false });
  });
});

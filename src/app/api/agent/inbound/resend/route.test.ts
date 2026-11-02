import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handleReply = vi.fn(async () => "acted");
vi.mock("@/lib/agent/run", () => ({ handleReply }));

const KEY = Buffer.from("route-test-key").toString("base64");
const post = async (body: string, signed = true) => {
  const { POST } = await import("./route");
  const id = "msg_1";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", Buffer.from(KEY, "base64"))
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return POST(
    new Request("http://x.test/api/agent/inbound/resend", {
      method: "POST",
      body,
      headers: signed
        ? { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${signature}` }
        : {},
    }),
  );
};
const received = JSON.stringify({ type: "email.received", data: { email_id: "em_1" } });

describe("Resend's inbound webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("RESEND_WEBHOOK_SECRET", `whsec_${KEY}`);
    vi.stubEnv("RESEND_API_KEY", "k");
    // A mock of Resend: this never reaches the real API.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              from: "support@co.test",
              to: ["reply+abcdefghij0123456789@agent.jane.test"],
              subject: "Re: your request",
              text: "All done",
            }),
          ),
      ),
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("refuses without a good signature, or with no secret set", async () => {
    expect((await post(received, false)).status).toBe(401);
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "");
    expect((await post(received)).status).toBe(401);
    expect(handleReply).not.toHaveBeenCalled();
  });

  it("hands the reply to the agent, by the address it was sent to", async () => {
    const response = await post(received);
    expect(await response.json()).toEqual({ result: "acted" });
    expect(handleReply).toHaveBeenCalledWith("reply+abcdefghij0123456789@agent.jane.test", {
      from: "support@co.test",
      subject: "Re: your request",
      body: "All done",
    });
  });

  it("ignores other events, and a mail to no reply address", async () => {
    const other = await post(JSON.stringify({ type: "email.sent" }));
    expect(await other.json()).toEqual({ result: "ignored" });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ to: ["hello@agent.jane.test"], text: "hi" })),
      ),
    );
    expect(await (await post(received)).json()).toEqual({ result: "unknown" });
    expect(handleReply).not.toHaveBeenCalled();
  });
});

import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { fetchReceivedEmail, verifySvix, WEBHOOK_TOLERANCE_MS } from "./resend-inbound";

// Resend's inbound email, against a mock: never its real API.

const NOW = new Date("2026-11-02T12:00:00Z");
const KEY = Buffer.from("a-test-signing-key").toString("base64");
const SECRET = `whsec_${KEY}`;
const seconds = String(Math.floor(NOW.getTime() / 1000));
const sign = (body: string, id = "msg_1", timestamp = seconds) =>
  createHmac("sha256", Buffer.from(KEY, "base64"))
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
const headers = (signature: string, timestamp = seconds, id = "msg_1") => ({
  id,
  timestamp,
  signature,
});

describe("the Svix signature", () => {
  const body = JSON.stringify({ type: "email.received" });

  it("accepts the real one, among several", () => {
    expect(verifySvix(body, headers(`v1,${sign(body)}`), SECRET, NOW)).toBe(true);
    expect(verifySvix(body, headers(`v1,bad v1,${sign(body)}`), SECRET, NOW)).toBe(true);
  });

  it("refuses a changed body, a wrong secret, or no headers", () => {
    expect(verifySvix(`${body} `, headers(`v1,${sign(body)}`), SECRET, NOW)).toBe(false);
    expect(verifySvix(body, headers(`v1,${sign(body)}`), "whsec_d3Jvbmc=", NOW)).toBe(false);
    expect(verifySvix(body, { id: null, timestamp: seconds, signature: "x" }, SECRET, NOW)).toBe(
      false,
    );
    expect(verifySvix(body, headers(`v1,${sign(body)}`), "", NOW)).toBe(false);
  });

  it("refuses an old one, so it can't be replayed", () => {
    const old = String(Math.floor((NOW.getTime() - WEBHOOK_TOLERANCE_MS - 2000) / 1000));
    expect(verifySvix(body, headers(`v1,${sign(body, "msg_1", old)}`, old), SECRET, NOW)).toBe(
      false,
    );
  });
});

describe("fetching the email", () => {
  const answer = (body: unknown, status = 200) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("reads the text, by the email's id, with the key", async () => {
    const fetcher = answer({
      from: "a@co.test",
      to: ["reply+abc@x.test"],
      subject: "Re",
      text: "Done",
    });
    const mail = await fetchReceivedEmail("em/1", { apiKey: "k", fetcher });
    expect(mail).toEqual({
      from: "a@co.test",
      to: ["reply+abc@x.test"],
      subject: "Re",
      text: "Done",
    });
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe(
      "https://api.resend.com/emails/receiving/em%2F1",
    );
    expect(vi.mocked(fetcher).mock.calls[0][1]).toMatchObject({
      headers: { authorization: "Bearer k" },
    });
  });

  it("falls back to the HTML with the tags out", async () => {
    const mail = await fetchReceivedEmail("e", {
      apiKey: "k",
      fetcher: answer({ html: "<p>Refund <b>sent</b></p><style>p{}</style>", to: [] }),
    });
    expect(mail.text).toBe("Refund sent");
  });

  it("says so when Resend refuses", async () => {
    await expect(
      fetchReceivedEmail("e", { apiKey: "k", fetcher: answer({}, 403) }),
    ).rejects.toThrow("403");
  });
});

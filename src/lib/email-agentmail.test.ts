import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "./email";

// The second sender (EMAIL_PROVIDER=agentmail) behind the same sendEmail: chosen by env, same guards,
// same headers. No request ever leaves these tests: fetch is a stub.

const mail = {
  to: "sam@example.com",
  subject: "Jane: your daily report, Nov 23",
  text: "Hello",
  html: "<p>Hello</p>",
  headers: { "List-Unsubscribe": "<https://app.example.com/api/unsubscribe?token=t&what=daily>" },
};

describe("sendEmail by provider", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "Jane <hello@app.test>");
    vi.stubEnv("AGENTMAIL_API_KEY", "am_test_key");
    vi.stubEnv("AGENTMAIL_INBOX_ID", "jane-reports@agentmail.to");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("stays on Resend unless EMAIL_PROVIDER says agentmail", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "re_1" }), { status: 200 }));
    expect(await sendEmail(mail)).toEqual({ id: "re_1" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.resend.com/emails");

    vi.stubEnv("EMAIL_PROVIDER", "resend");
    await sendEmail(mail);
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.resend.com/emails");
  });

  it("sends through AgentMail from its inbox, with the headers (the one-click unsubscribe) and its id", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "agentmail");
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message_id: "msg_9", thread_id: "th_9" }), { status: 200 }),
    );

    expect(await sendEmail({ ...mail, replyTo: "reply@example.com" })).toEqual({ id: "msg_9" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://api.agentmail.to/v0/inboxes/jane-reports%40agentmail.to/messages/send",
    );
    expect(init.headers.authorization).toBe("Bearer am_test_key");
    expect(init.redirect).toBe("error");
    expect(JSON.parse(init.body)).toEqual({
      to: "sam@example.com",
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      headers: mail.headers,
      reply_to: "reply@example.com",
    });
  });

  it("says what is missing, and never sends, when AgentMail isn't set up", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "agentmail");
    vi.stubEnv("AGENTMAIL_API_KEY", "");
    await expect(sendEmail(mail)).rejects.toThrow("AGENTMAIL_API_KEY and AGENTMAIL_INBOX_ID");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the address and links out of AgentMail's error words", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "agentmail");
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          name: "MessageRejectedError",
          message:
            "Recipient(s) blocked: bob@example.com (not in allow list). See https://docs.agentmail.to/x",
        }),
        { status: 403 },
      ),
    );
    const error = await sendEmail(mail).catch((e) => e);
    expect(error.message).toContain("AgentMail rejected the email (403)");
    expect(error.message).toContain("not in allow list");
    expect(error.message).not.toContain("bob@example.com");
    expect(error.message).not.toContain("https://");
  });

  it("never sends to a trial person's address, whichever sender is chosen", async () => {
    for (const provider of ["", "agentmail"]) {
      vi.stubEnv("EMAIL_PROVIDER", provider);
      expect(await sendEmail({ ...mail, to: "x@try.jane.invalid" })).toBeUndefined();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

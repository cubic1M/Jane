import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendMagicLink } from "./email";

const URL_WITH_QUERY = "https://app.test/api/auth/callback/resend?token=abc&email=a%40b.com";

describe("sendMagicLink", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "Financial Controller <hello@app.test>");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  // Founder's admin sign-in, 11-02: production logged "[auth][error] Error" three times and nothing
  // said why. Resend's own words can name the address, as this one does.
  describe("when the send fails", () => {
    const rejected = JSON.stringify({
      statusCode: 403,
      name: "validation_error",
      message:
        "You can only send testing emails to your own email address (owner@secret.test). Verify a domain at https://resend.com/domains?token=abc",
    });
    let logged: unknown[][];

    beforeEach(() => {
      logged = [];
      vi.spyOn(console, "error").mockImplementation((...args) => void logged.push(args));
    });
    afterEach(() => vi.restoreAllMocks());

    const logText = () => JSON.stringify(logged);

    it("logs Resend's status and words, with no address or link", async () => {
      fetchMock.mockResolvedValue(new Response(rejected, { status: 403 }));
      await expect(sendMagicLink({ to: "a@b.com", url: URL_WITH_QUERY })).rejects.toThrow();
      expect(logText()).toContain("[magic-link]");
      expect(logText()).toContain("403");
      expect(logText()).toContain("validation_error");
      expect(logText()).toContain("You can only send testing emails");
      for (const secret of ["owner@secret.test", "a@b.com", "token=abc", "resend.com/domains"]) {
        expect(logText()).not.toContain(secret);
      }
    });

    it("keeps the address and link out of what it throws too", async () => {
      fetchMock.mockResolvedValue(new Response(rejected, { status: 403 }));
      const error = await sendMagicLink({ to: "a@b.com", url: URL_WITH_QUERY }).catch((e) => e);
      expect(error.message).toContain("403");
      expect(error.message).not.toContain("owner@secret.test");
      expect(error.message).not.toContain("token=abc");
    });

    it("logs a body that isn't JSON, scrubbed and cut short", async () => {
      fetchMock.mockResolvedValue(
        new Response(`<html>bad gateway x@y.co ${"z".repeat(2000)}</html>`, { status: 502 }),
      );
      await expect(sendMagicLink({ to: "a@b.com", url: URL_WITH_QUERY })).rejects.toThrow();
      expect(logText()).toContain("502");
      expect(logText()).not.toContain("x@y.co");
      expect(logText().length).toBeLessThan(600);
    });

    it("logs a send that never reached Resend", async () => {
      fetchMock.mockRejectedValue(new Error("connect ETIMEDOUT for a@b.com"));
      await expect(sendMagicLink({ to: "a@b.com", url: URL_WITH_QUERY })).rejects.toThrow();
      expect(logText()).toContain("[magic-link]");
      expect(logText()).toContain("ETIMEDOUT");
      expect(logText()).not.toContain("a@b.com");
    });

    it("logs missing settings as that", async () => {
      vi.stubEnv("EMAIL_FROM", "");
      await expect(sendMagicLink({ to: "a@b.com", url: URL_WITH_QUERY })).rejects.toThrow();
      expect(logText()).toContain("RESEND_API_KEY and EMAIL_FROM must be set");
    });
  });

  it("sends the link through Resend", async () => {
    await sendMagicLink({ to: "a@b.com", url: URL_WITH_QUERY });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [endpoint, init] = fetchMock.mock.calls[0];
    expect(endpoint).toBe("https://api.resend.com/emails");
    expect(init.headers.authorization).toBe("Bearer re_test");

    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ from: "Financial Controller <hello@app.test>", to: "a@b.com" });
    // Debugger 10-30: a new Jane user's first email said "Financial Controller".
    expect(body.subject).toBe("Your sign-in link for Jane");
    expect(`${body.text} ${body.html}`).not.toMatch(/Financial Controller/);
    expect(body.text).toContain(URL_WITH_QUERY);
    expect(body.html).toContain(URL_WITH_QUERY.replaceAll("&", "&amp;"));
  });

  // A forged X-Forwarded-Host reached Auth.js's link on a local production build: the email went to
  // the right person with a working token, on the attacker's site.
  it("mails the link on the site's own address, whatever the request said", async () => {
    vi.stubEnv("APP_URL", "https://jane.example/");
    await sendMagicLink({
      to: "a@b.com",
      url: "https://evil.example/api/auth/callback/resend?callbackUrl=https%3A%2F%2Fevil.example%2Fhome&token=abc&email=a%40b.com",
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(`${body.text} ${body.html}`).not.toContain("evil.example");
    expect(body.text).toContain(
      "https://jane.example/api/auth/callback/resend?callbackUrl=https%3A%2F%2Fjane.example%2Fhome&token=abc&email=a%40b.com",
    );
  });

  it("uses Vercel's production domain when APP_URL isn't set", async () => {
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "jane.vercel.example");
    await sendMagicLink({ to: "a@b.com", url: URL_WITH_QUERY });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).text).toContain(
      "https://jane.vercel.example/api/auth/callback/resend?token=abc",
    );
  });

  it("throws when Resend rejects the email", async () => {
    fetchMock.mockResolvedValue(new Response("invalid from", { status: 422 }));

    await expect(sendMagicLink({ to: "a@b.com", url: URL_WITH_QUERY })).rejects.toThrow("422");
  });

  it("prints the link in development when Resend is not configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("NODE_ENV", "development");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await sendMagicLink({ to: "a@b.com", url: URL_WITH_QUERY });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringContaining(URL_WITH_QUERY));
  });

  it("never prints the link in production", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await expect(sendMagicLink({ to: "a@b.com", url: URL_WITH_QUERY })).rejects.toThrow(
      "RESEND_API_KEY",
    );
    expect(info).not.toHaveBeenCalled();
  });
});

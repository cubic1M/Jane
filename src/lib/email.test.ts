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

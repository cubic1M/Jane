import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { emailFeedback } from "./feedback-email";

// A beta tester's feedback reaches the founders by email: their words and the page, never a
// balance, an account or the screenshot itself.
type Sent = { to: string; subject: string; text: string; html: string; replyTo?: string };

describe("emailFeedback", () => {
  const send = vi.fn(async (_email: Sent) => undefined);
  const sent = () => send.mock.calls.map(([m]) => m);

  beforeEach(() => {
    send.mockClear();
    vi.stubEnv("ADMIN_EMAILS", "a@example.test,b@example.test");
    vi.stubEnv("APP_URL", "https://jane.example");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("sends each founder the words and the page, with replies going to the person", async () => {
    const ok = await emailFeedback(
      {
        path: "/home",
        message: "The <tree> is great",
        screenshot: true,
        replyTo: "student@example.edu",
      },
      { send },
    );
    expect(ok).toBe(true);
    expect(sent().map((m) => m.to)).toEqual(["a@example.test", "b@example.test"]);
    const [mail] = sent();
    expect(mail.subject).toBe("Jane feedback: /home");
    expect(mail.replyTo).toBe("student@example.edu");
    expect(mail.text).toContain("The <tree> is great");
    expect(mail.html).toContain("The &lt;tree&gt; is great");
    expect(mail.text).toContain("A screenshot is attached on /admin/reports.");
    expect(mail.text).toContain("https://jane.example/admin/reports");
  });

  it("sends nothing with no team, and never throws when the email fails", async () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    const report = { path: "/home", message: "Hi", screenshot: false, replyTo: null };
    expect(await emailFeedback(report, { send })).toBe(false);
    expect(send).not.toHaveBeenCalled();
    vi.stubEnv("ADMIN_EMAILS", "a@example.test");
    vi.spyOn(console, "error").mockImplementation(() => {});
    send.mockRejectedValueOnce(new Error("down"));
    expect(await emailFeedback(report, { send })).toBe(false);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));

import { sendEmail } from "@/lib/email";
import { sendStatusEmail, statusEmail } from "./action-emails";

describe("statusEmail", () => {
  it("tells the person exactly what to do when waiting on them", () => {
    expect(statusEmail("waiting_on_user", "Cancel Netflix", "Forward the email")).toEqual({
      subject: "We need something from you: Cancel Netflix",
      lines: ['To finish "Cancel Netflix", we need you to:', "Forward the email"],
    });
  });

  it("keeps the team's failure reason out of the email", () => {
    expect(JSON.stringify(statusEmail("failed", "Cancel Netflix", null))).not.toMatch(/reason/i);
  });

  it("sends nothing for a move back to queued", () => {
    expect(statusEmail("queued", "x", null)).toBeNull();
  });
});

describe("sendStatusEmail", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(sendEmail).mockReset();
  });

  it("sends through Resend with a link to the actions page, escaping HTML", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("APP_URL", "https://app.example.com");

    await sendStatusEmail("a@example.com", { subject: "Done: <b>", lines: ["<script>"] });

    const mail = vi.mocked(sendEmail).mock.calls[0][0];
    expect(mail.to).toBe("a@example.com");
    expect(mail.text).toContain("https://app.example.com/actions");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).not.toContain("<script>");
  });

  it("prints instead of sending in local dev without Resend", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await sendStatusEmail("a@example.com", { subject: "Done: x", lines: ["x"] });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalled();
  });
});

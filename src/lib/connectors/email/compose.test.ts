import { describe, expect, it } from "vitest";
import { cancelRoute } from "../cancel/route";
import { composeLinks, emailSender } from "./compose";

// Connectors roadmap round 19: a first email to a company goes from the person's own address.

const draft = {
  to: "Cancellations@Equinox.com",
  subject: "Please cancel my Equinox membership",
  body: "Hello,\n\nPlease cancel it & confirm.\n\nThanks",
};

describe("composeLinks", () => {
  it("opens the draft ready to send in a mail app, Gmail or Outlook, every value encoded", () => {
    const links = composeLinks({ ...draft, bcc: "a+act_1@agent.example.test" });
    expect(links.mailto).toBe(
      "mailto:Cancellations%40Equinox.com?subject=Please%20cancel%20my%20Equinox%20membership&body=Hello%2C%0A%0APlease%20cancel%20it%20%26%20confirm.%0A%0AThanks&bcc=a%2Bact_1%40agent.example.test",
    );
    expect(
      links.gmail.startsWith(
        "https://mail.google.com/mail/?view=cm&fs=1&to=Cancellations%40Equinox.com&su=",
      ),
    ).toBe(true);
    expect(links.gmail).toContain("&bcc=a%2Bact_1%40agent.example.test");
    expect(
      links.outlook.startsWith(
        "https://outlook.live.com/mail/0/deeplink/compose?to=Cancellations%40Equinox.com",
      ),
    ).toBe(true);
    // Outlook's link takes no Bcc.
    expect(links.outlook).not.toContain("bcc");
    // The ampersand in the body can't start a new parameter.
    expect(links.mailto).not.toContain("& confirm");
  });

  it("refuses anything that could add a header: a line break in the subject, or a bad address", () => {
    expect(() => composeLinks({ ...draft, subject: "Cancel\r\nBcc: someone@else.test" })).toThrow(
      "line break",
    );
    expect(() => composeLinks({ ...draft, to: "a@b.test\nbcc:x@y.test" })).toThrow(
      "Not an email address",
    );
    expect(() => composeLinks({ ...draft, to: "not an address" })).toThrow("Not an email address");
    expect(() => composeLinks({ ...draft, bcc: "a@b.test, c@d.test" })).toThrow(
      "Not an email address",
    );
  });
});

describe("who sends a company email", () => {
  it("is the person, unless the company takes an assistant's email or opened the thread", () => {
    expect(emailSender({})).toBe("person");
    expect(emailSender({ acceptsAgentEmail: false })).toBe("person");
    expect(emailSender({ acceptsAgentEmail: true })).toBe("jane");
    expect(emailSender({ companyOpenedThread: true })).toBe("jane");
  });

  it("is the person for every merchant that cancels by email today, with the draft ready", () => {
    const route = cancelRoute({ merchant: "Equinox" });
    expect(route).toMatchObject({
      channel: "email",
      sentBy: "person",
      email: "Cancellations@Equinox.com",
    });
    expect(route.compose?.mailto.startsWith("mailto:Cancellations%40Equinox.com?subject=")).toBe(
      true,
    );
    expect(cancelRoute({ merchant: "Netflix" })).toMatchObject({ sentBy: null, compose: null });
  });
});

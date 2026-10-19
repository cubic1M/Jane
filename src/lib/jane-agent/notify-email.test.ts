import { describe, expect, it } from "vitest";
import { renderChatEmail } from "./notify-email";

// Spec step 85: one email for a batch of Jane's messages, with one-tap links.

const links = {
  chat: "https://jane.test/chat",
  settings: "https://jane.test/settings#jane-messages",
  unsubscribe: "https://jane.test/unsubscribe?token=t&what=chat",
};

const messages = [
  {
    kind: "decision",
    body: "Netflix went up to $22.99. Want me to <ask> for the old price?",
    buttons: [
      { label: "Yes", url: "https://jane.test/chat/reply?token=a" },
      { label: "No", url: "https://jane.test/chat/reply?token=b" },
    ],
    chatUrl: "https://jane.test/chat#m1",
  },
  {
    kind: "heads_up",
    body: "Your FSA deadline is in 3 days.",
    buttons: [],
    chatUrl: "https://jane.test/chat#m2",
  },
];

describe("renderChatEmail", () => {
  it("puts every message, with its buttons and a link to the chat, in one email", () => {
    const email = renderChatEmail(messages, links);
    expect(email.subject).toBe("Jane: 2 things for you");
    expect(email.text).toContain("jane> to decide");
    expect(email.text).toContain("[ Yes ] https://jane.test/chat/reply?token=a");
    expect(email.text).toContain("[ No ] https://jane.test/chat/reply?token=b");
    expect(email.text).toContain("Open in the chat: https://jane.test/chat#m2");
    expect(email.text).toContain(`Stop these emails: ${links.unsubscribe}`);
    expect(email.html).toContain('href="https://jane.test/chat/reply?token=a"');
    expect(email.html).toContain("[ Yes ]");
    expect(email.html).toContain("monospace");
  });

  it("escapes the message in HTML", () => {
    const { html } = renderChatEmail(messages, links);
    expect(html).toContain("&lt;ask&gt;");
    expect(html).not.toContain("<ask>");
  });

  it("says one thing for one message", () => {
    expect(renderChatEmail(messages.slice(1), links).subject).toBe("Jane: 1 thing for you");
  });
});

import { describe, expect, it } from "vitest";
import { chatMessageHref, withFrom } from "./back-link";

// Spec step 86: a page opened from one of Jane's messages knows which, to link back.

describe("withFrom", () => {
  it("adds the message to the app's own pages", () => {
    expect(withFrom("/report/f1", "m1")).toBe("/report/f1?from=m1");
    expect(withFrom("/afford?kind=purchase&amount=9.00", "m1")).toBe(
      "/afford?kind=purchase&amount=9.00&from=m1",
    );
    expect(withFrom("/settings#autopilot", "m1")).toBe("/settings?from=m1#autopilot");
  });

  it("leaves the chat, other sites and odd ids alone", () => {
    expect(withFrom("/chat", "m1")).toBe("/chat");
    expect(withFrom("/chat#m2", "m1")).toBe("/chat#m2");
    expect(withFrom("https://netflix.com/cancel", "m1")).toBe("https://netflix.com/cancel");
    expect(withFrom("//evil.example", "m1")).toBe("//evil.example");
    expect(withFrom("/plan", "m1&x=1")).toBe("/plan");
  });
});

describe("chatMessageHref", () => {
  it("links to the message in the chat, only for an id that looks like one", () => {
    expect(chatMessageHref("cmabc123")).toBe("/chat#cmabc123");
    expect(chatMessageHref("<script>")).toBeNull();
    expect(chatMessageHref(null)).toBeNull();
    expect(chatMessageHref("")).toBeNull();
  });
});

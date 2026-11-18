import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));

import ContinueSignInPage from "./page";

const open = (query: Record<string, string>) =>
  ContinueSignInPage({ searchParams: Promise.resolve(query) });

describe("the page a sign-in link lands on", () => {
  it("names the account, and opens Jane with one tap", async () => {
    const html = renderToStaticMarkup(await open({ token: "abc", email: "a@b.test" }));
    expect(html).toContain("You&#x27;re almost in");
    expect(html.replace(/<[^>]+>/g, "")).toContain("One tap to open Jane as a@b.test.");
    expect(html).toMatch(/<button type="submit"[^>]*>Open Jane<\/button>/);
    expect(html.replace(/<[^>]+>/g, "")).toContain(
      "Not your email, or you didn&#x27;t ask for this link? Don&#x27;t continue.",
    );
  });

  it.each([
    "Your account is locked call 555-0100",
    "a@b.test and more words",
    "no-at-sign",
    "x".repeat(300) + "@b.test",
  ])("won't show %s: it comes from the address bar", async (email) => {
    await expect(open({ token: "abc", email })).rejects.toThrow("redirect /login");
  });

  it("sends a link with no token back to sign in", async () => {
    await expect(open({ email: "a@b.test" })).rejects.toThrow("redirect /login");
  });
});

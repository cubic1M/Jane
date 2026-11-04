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
  it("names the account", async () => {
    const page = await open({ token: "abc", email: "a@b.test" });
    expect(renderToStaticMarkup(page)).toContain("Sign in as a@b.test");
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

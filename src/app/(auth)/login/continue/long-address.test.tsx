import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));

import ContinueSignInPage from "./page";

// Debugger 11-17 (r335, sign-up on a phone, 375 wide): the heading read "Sign in as
// r335.student@example" with ".com?" cut off at the edge. An address has no spaces, so the heading
// couldn't wrap it (431px in 327px) and the page clips what runs over; a school address like
// jordan.smith@stanford.edu is cut the same way. The heading that names it may break it anywhere.

describe("the sign-in heading on a phone", () => {
  it("lets a long address wrap instead of running off the edge", async () => {
    const page = await ContinueSignInPage({
      searchParams: Promise.resolve({ token: "abc", email: "jordan.smith@stanford.edu" }),
    });
    const heading = /<h1 class="([^"]*)">([^<]*)<\/h1>/.exec(renderToStaticMarkup(page));
    expect(heading?.[2]).toBe("Sign in as jordan.smith@stanford.edu?");
    expect(heading?.[1].split(" ")).toContain("[overflow-wrap:anywhere]");
  });
});

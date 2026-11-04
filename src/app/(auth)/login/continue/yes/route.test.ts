import { describe, expect, it } from "vitest";
import { LINK_CONFIRM_COOKIE, linkConfirmValue } from "@/lib/sign-in-link";
import { POST } from "./route";

const yes = (fields: Record<string, string>, headers: Record<string, string>) => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return POST(
    new Request("https://jane.test/login/continue/yes", { method: "POST", body, headers }),
  );
};
const same = { origin: "https://jane.test", host: "jane.test" };
const link = { token: "abc", email: "a@b.test" };

describe("saying yes to a sign-in link", () => {
  it("marks this browser for this link only, and goes on to the link", async () => {
    const answer = await yes(link, same);
    expect(answer.status).toBe(303);
    const to = new URL(answer.headers.get("location")!);
    expect(to.pathname).toBe("/api/auth/callback/resend");
    expect(to.searchParams.get("token")).toBe("abc");
    const cookie = answer.cookies.get(LINK_CONFIRM_COOKIE);
    expect(cookie).toMatchObject({
      value: linkConfirmValue("abc", "a@b.test"),
      httpOnly: true,
      sameSite: "lax",
    });
  });

  // Debugger 11-04: behind a proxy or under `next start`, the server's own name isn't the address the
  // person is on. The link went to localhost, without the cookie just set on their address, and
  // sign-in bounced back to /login.
  it("goes on at the address the person is on, not the server's own name", async () => {
    const body = new FormData();
    body.set("token", "abc");
    body.set("email", "a@b.test");
    const answer = await POST(
      new Request("http://localhost:3000/login/continue/yes", {
        method: "POST",
        body,
        headers: { origin: "https://app.jane.test", "x-forwarded-host": "app.jane.test" },
      }),
    );
    expect(new URL(answer.headers.get("location")!).origin).toBe("https://app.jane.test");
  });

  it("always goes to this site's link, whatever it's told", async () => {
    const answer = await yes({ ...link, callbackUrl: "https://evil.test" }, same);
    expect(new URL(answer.headers.get("location")!).host).toBe("jane.test");
  });

  it.each([
    ["another site", { origin: "https://evil.test", host: "jane.test" }],
    ["no origin", { host: "jane.test" }],
    ["a nonsense origin", { origin: "null", host: "jane.test" }],
  ])("sets nothing for a post from %s: that's the attack this page stops", async (_, headers) => {
    const answer = await yes(link, headers);
    expect(new URL(answer.headers.get("location")!).pathname).toBe("/login");
    expect(answer.cookies.get(LINK_CONFIRM_COOKIE)).toBeUndefined();
  });

  it("sets nothing without a token", async () => {
    const answer = await yes({ email: "a@b.test" }, same);
    expect(answer.cookies.get(LINK_CONFIRM_COOKIE)).toBeUndefined();
  });
});

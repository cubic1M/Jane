import { describe, expect, it } from "vitest";
import { LINK_CONFIRM_COOKIE } from "@/lib/sign-in-link";
import { POST } from "./route";

const yes = (url: string, headers: Record<string, string>) => {
  const body = new FormData();
  body.set("token", "abc");
  body.set("email", "a@b.test");
  return POST(new Request(url, { method: "POST", body, headers }));
};

describe("a yes posted from a plain-HTTP page to the HTTPS site", () => {
  it.each([
    ["behind the proxy", "http://localhost:3000", { "x-forwarded-proto": "https" }],
    ["directly", "https://jane.test", {}],
  ])("sets nothing, %s", async (_, base, extra) => {
    const answer = await yes(`${base}/login/continue/yes`, {
      origin: "http://jane.test",
      host: "jane.test",
      ...extra,
    });
    expect(new URL(answer.headers.get("location")!).pathname).toBe("/login");
    expect(answer.cookies.get(LINK_CONFIRM_COOKIE)).toBeUndefined();
  });

  it("still works on a local machine over plain HTTP", async () => {
    const answer = await yes("http://localhost:3000/login/continue/yes", {
      origin: "http://localhost:3000",
      host: "localhost:3000",
      "x-forwarded-proto": "http",
    });
    expect(answer.cookies.get(LINK_CONFIRM_COOKIE)).toBeDefined();
  });
});

import { parse as authParse } from "../../node_modules/@auth/core/lib/vendored/cookie.js";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { sessionTokenFrom } from "./admin-gate";
import { edgeLimit } from "./edge-limits";

// The limits here count the session Next.js reads from the cookie header; Auth.js signs the request
// in from the one it reads. A header the two read differently is refused before either is used.
const NAME = "__Secure-authjs.session-token";
const allow = async () => ({ ok: true, remaining: 1, retryAfterSeconds: 0 });
const answer = (cookie: string) => {
  const request = new NextRequest("https://jane.test/api/decisions", { headers: { cookie } });
  return edgeLimit(
    {
      method: "GET",
      pathname: "/api/decisions",
      headers: request.headers,
      cookies: request.cookies,
    },
    { hit: allow },
  );
};

describe("a session cookie the limits would read differently from Auth.js", () => {
  it.each([
    ["the same name twice", `${NAME}=trial_real; ${NAME}=junk`],
    ["a space before the equals sign", `${NAME} =trial_real`],
    ["a space after the value", `${NAME}=trial_real ; a=b`],
    ["quotes around the value", `${NAME}="trial_real"`],
    ["the name again with no value", `${NAME}=trial_real; ${NAME}`],
    ["a tab before the name", `a=b;\t${NAME}=trial_real`],
  ])("is refused: %s", async (_what, cookie) => {
    expect((await answer(cookie))?.status).toBe(400);
  });

  it.each([
    ["one session", `a=b; ${NAME}=0b7c2d1e-aaaa-bbbb-cccc-1234567890ab; c=d`],
    ["a sample person's", `${NAME}=trial_abc-DEF_123`],
    ["the local name", "authjs.session-token=abc"],
    ["the same cookie sent twice", `${NAME}=abc; ${NAME}=abc`],
    ["signed out", `${NAME}=; theme=dark`],
    ["no session at all", "theme=dark; invite=x y"],
  ])("goes on: %s", async (_what, cookie) => {
    expect(await answer(cookie)).toBeNull();
  });

  // What lets through is read the same by both.
  it("reads what goes on the same way Auth.js does", () => {
    const cookie = `a=b; ${NAME}=abc%3D1; ${NAME}=abc%3D1`;
    const request = new NextRequest("https://jane.test/", { headers: { cookie } });
    expect(sessionTokenFrom(request.cookies)).toBe(
      (authParse(cookie) as Record<string, string>)[NAME],
    );
  });
});

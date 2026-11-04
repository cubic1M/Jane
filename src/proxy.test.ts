import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/admin-access", () => ({ logAdminAccess: vi.fn() }));
vi.mock("@/lib/admin-gate", () => ({ adminSession: vi.fn(), sessionTokenFrom: vi.fn() }));
vi.mock("@/lib/edge-limits", () => ({ edgeLimit: vi.fn() }));

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { NextRequest, type NextFetchEvent } from "next/server";
import { LINK_CONFIRM_COOKIE, linkConfirmValue } from "@/lib/sign-in-link";
import { config, proxy } from "./proxy";

const covered = (path: string) => new RegExp(`^${config.matcher[0]}$`).test(path);

const publicFiles = (dir = "public"): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? publicFiles(path) : [`/${path.slice("public/".length)}`];
  });

describe("which requests the proxy sees", () => {
  // On a local build /join/x.y came back with no Content-Security-Policy at all.
  it.each([
    "/",
    "/login",
    "/report/abc.x",
    "/join/abc.x",
    "/admin/actions/abc.x",
    "/api/documents/a.pdf",
  ])("covers %s, a dot or not", (path) => expect(covered(path)).toBe(true));

  it("leaves out Next.js's own files and every file in public/", () => {
    for (const path of ["/_next/static/chunks/a.js", "/_next/image", "/favicon.ico"]) {
      expect(covered(path)).toBe(false);
    }
    for (const path of publicFiles()) expect(covered(path)).toBe(false);
  });
});

describe("a sign-in link", () => {
  const link = "https://jane.test/api/auth/callback/resend?token=abc&email=a%40b.test";
  const event = {} as NextFetchEvent;

  it("doesn't sign anyone in until this browser says yes on a page naming the account", async () => {
    const answer = await proxy(new NextRequest(link), event);
    expect(answer.status).toBe(307);
    const to = new URL(answer.headers.get("location")!);
    expect(to.pathname).toBe("/login/continue");
    expect(to.searchParams.get("email")).toBe("a@b.test");
    expect(to.searchParams.get("token")).toBe("abc");
  });

  it("can't be got past with a field repeated, which Auth.js reads differently", async () => {
    for (const repeated of [
      "token=&token=abc&email=a%40b.test",
      "token=x&token=abc&email=a%40b.test",
      "token=abc&email=me%40b.test&email=a%40b.test",
    ]) {
      const asked = new NextRequest(`https://jane.test/api/auth/callback/resend?${repeated}`);
      const answer = await proxy(asked, event);
      expect(new URL(answer.headers.get("location")!).pathname, repeated).toBe("/login");
    }
  });

  it("isn't let through by a yes given to a page naming someone else's address", async () => {
    const victim = linkConfirmValue("abc", "victim@b.test");
    const asked = new NextRequest(link, {
      headers: { cookie: `${LINK_CONFIRM_COOKIE}=${victim}` },
    });
    const answer = await proxy(asked, event);
    expect(new URL(answer.headers.get("location")!).pathname).toBe("/login/continue");
  });

  it("goes through once it has, for that link only", async () => {
    const asked = (value: string) =>
      new NextRequest(link, { headers: { cookie: `${LINK_CONFIRM_COOKIE}=${value}` } });
    const yes = await proxy(asked(linkConfirmValue("abc", "a@b.test")), event);
    expect(yes.headers.get("location")).toBeNull();
    const other = await proxy(asked(linkConfirmValue("another-link", "a@b.test")), event);
    expect(new URL(other.headers.get("location")!).pathname).toBe("/login/continue");
  });
});

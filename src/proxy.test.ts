import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/admin-access", () => ({ logAdminAccess: vi.fn() }));
vi.mock("@/lib/admin-gate", () => ({ adminSession: vi.fn(), sessionTokenFrom: vi.fn() }));
vi.mock("@/lib/edge-limits", () => ({ edgeLimit: vi.fn() }));

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { config } from "./proxy";

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

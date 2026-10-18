import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Access tokens live only on the server. Nothing that runs in the browser may import the
// modules that handle them.
const SERVER_ONLY = ["@/lib/plaid", "@/lib/crypto", "@/data-sources/plaid", "plaid"];

const root = join(process.cwd(), "src");
const clientFiles = (readdirSync(root, { recursive: true }) as string[])
  .filter((f) => /\.tsx?$/.test(f))
  .filter((f) => /^["']use client["']/.test(readFileSync(join(root, f), "utf8")));

describe("client components", () => {
  it("include the Plaid Link button", () => {
    expect(clientFiles).toContain(join("app", "connect", "link-button.tsx"));
  });

  it.each(clientFiles)("%s imports nothing that handles access tokens", (file) => {
    const source = readFileSync(join(root, file), "utf8");
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    for (const path of imports) {
      expect(SERVER_ONLY.some((p) => path === p || path.startsWith(`${p}/`))).toBe(false);
    }
  });
});

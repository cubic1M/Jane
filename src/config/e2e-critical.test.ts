import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Every PR push runs the tests tagged @critical (docs/ci.md). A tag lost in a rewrite would shrink
// that set without any test failing, so its size and its reach are held here.
const specs = readdirSync("e2e").filter((f) => f.endsWith(".spec.ts"));
const tagged = specs.filter((f) => / @critical["`]/.test(readFileSync(join("e2e", f), "utf8")));

describe("the end-to-end tests every PR runs", () => {
  it("are about twenty", () => {
    const count = specs
      .map((f) => readFileSync(join("e2e", f), "utf8").match(/ @critical["`]/g)?.length ?? 0)
      .reduce((a, b) => a + b, 0);
    expect(count).toBeGreaterThanOrEqual(17);
    expect(count).toBeLessThanOrEqual(25);
  });

  it("cover signing in, uploading, the chat, deciding, deleting and access", () => {
    expect(tagged).toEqual(
      expect.arrayContaining([
        "auth.spec.ts",
        "mfa.spec.ts",
        "upload.spec.ts",
        "chat.spec.ts",
        "decisions.spec.ts",
        "settings.spec.ts",
        "admin.spec.ts",
        "security-headers.spec.ts",
      ]),
    );
  });
});

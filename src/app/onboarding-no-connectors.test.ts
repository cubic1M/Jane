import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Founder rule (11-19): signing up for Jane is one step plus one bank link, and no connector is ever
// asked for during sign-up or onboarding. A connector is offered only inside the card that needs it
// (ConnectTap, src/lib/connectors/connect.ts). Every file on the way in, from the landing page through
// sign-up, the first bank link, the scan and an invite, stays free of connector code and prompts.

const ONBOARDING = [
  "src/app/page.tsx",
  "src/app/(auth)",
  "src/app/connect",
  "src/app/scanning",
  "src/app/join",
  "src/app/import/page.tsx",
];

function files(path: string): string[] {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory())
    return /\.(tsx?|mdx?)$/.test(path) && !/\.test\./.test(path) ? [path] : [];
  return readdirSync(path).flatMap((name) => files(join(path, name)));
}

const PROMPTS = [
  /@\/lib\/connectors/,
  /@\/config\/connectors/,
  /connect-tap/,
  /<ConnectTap\b/,
  /settings\/connections/,
  /\bconnectorIds?\b/,
];

describe("sign-up and onboarding ask for no connector", () => {
  const all = ONBOARDING.flatMap(files);

  it("covers the way in", () => {
    expect(all.length).toBeGreaterThan(5);
    expect(all).toContain("src/app/connect/page.tsx");
  });

  it.each(all)("%s offers no connector", (file) => {
    const source = readFileSync(file, "utf8");
    for (const prompt of PROMPTS) expect(source, `${file} matches ${prompt}`).not.toMatch(prompt);
  });
});

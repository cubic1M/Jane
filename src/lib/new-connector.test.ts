import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { scaffold } from "../../scripts/new-connector.mjs";

// Section C7: the scaffold makes a connector's folder from a name, off for real people, never
// overwriting; what it makes passes its own test once copied into the repo (checked by tsc in CI on
// the real folders, here by its shape).

const root = mkdtempSync(join(tmpdir(), "new-connector-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("node scripts/new-connector.mjs", () => {
  it("makes the folder: client, sample, both registrations, and a test that they're off", () => {
    const made = scaffold({ id: "acme_rates", vendor: "Acme", root });
    const dir = join(root, "src/lib/connectors/acme-rates");
    expect(made.files.sort()).toEqual([
      "acme-rates.test.ts",
      "api.ts",
      "connector.ts",
      "sample.ts",
    ]);
    const connector = readFileSync(join(dir, "connector.ts"), "utf8");
    expect(connector).toContain('id: "acme_rates"');
    expect(connector).toContain("sandbox: false");
    expect(connector).toContain('id: "sandbox_acme_rates"');
    expect(connector).toContain("movesMoney: false");
    expect(readFileSync(join(dir, "acme-rates.test.ts"), "utf8")).toContain('toBe("switched_off")');
  });

  it("never overwrites, and wants a lower_snake_case id and a vendor", () => {
    expect(() => scaffold({ id: "acme_rates", vendor: "Acme", root })).toThrow(/already exists/);
    expect(() => scaffold({ id: "Acme-Rates", vendor: "Acme", root })).toThrow(/lower_snake_case/);
    expect(() => scaffold({ id: "acme_two", vendor: "", root })).toThrow(/vendor/);
    expect(existsSync(join(root, "src/lib/connectors/acme-two"))).toBe(false);
  });

  it("prints the steps left from the command line", () => {
    const out = execFileSync(
      "node",
      [join(process.cwd(), "scripts/new-connector.mjs"), "beta_bank", "Beta"],
      { cwd: root, encoding: "utf8" },
    );
    expect(out).toContain("Register betaBank and sandboxBetaBank");
    expect(out).toContain("never in sign-up");
  });
});

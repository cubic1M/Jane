import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { localDatabase } from "../../scripts/connector-walk-person.mjs";

// The fixture walk's own sample person (scripts/connector-walk-person.mjs) is made on a local scratch
// database only: never on a shared, preview or production one.

describe("node scripts/connector-walk-person.mjs", () => {
  it("takes a database on this machine only", () => {
    expect(localDatabase("postgresql://postgres:postgres@localhost:55432/connectors_walk")).toBe(
      true,
    );
    expect(localDatabase("postgresql://127.0.0.1:5432/x")).toBe(true);
    expect(localDatabase("postgresql://[::1]:5432/x")).toBe(true);
    expect(localDatabase("postgresql://ep-cool-name.us-east-2.aws.neon.tech/neondb")).toBe(false);
    expect(localDatabase("postgresql://localhost.example.com/x")).toBe(false);
    expect(localDatabase(undefined)).toBe(false);
    expect(localDatabase("not a url")).toBe(false);
  });

  it("refuses before connecting when DATABASE_URL isn't local", () => {
    let out = "";
    try {
      execFileSync("node", ["scripts/connector-walk-person.mjs"], {
        env: { ...process.env, DATABASE_URL: "postgresql://db.example.com:5432/jane" },
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (error) {
      out = String((error as { stderr?: string }).stderr);
    }
    expect(out).toContain("Refused");
  });
});

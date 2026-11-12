import { describe, expect, it, vi } from "vitest";
import pg from "pg";
import { withVerifyFull } from "./pg-url";

// Every new server instance logged pg's SSL alias warning, because Neon's DATABASE_URL says
// sslmode=require. Naming verify-full is what pg already does, minus the warning.
describe("withVerifyFull", () => {
  const neon = "postgresql://u:p@ep-x-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";

  it.each(["prefer", "require", "verify-ca"])("names %s as verify-full", (mode) => {
    const url = withVerifyFull(neon.replace("require", mode))!;
    expect(new URL(url).searchParams.get("sslmode")).toBe("verify-full");
    expect(new URL(url).host).toBe("ep-x-pooler.us-east-2.aws.neon.tech");
  });

  it("keeps every other part of the URL, and leaves other modes alone", () => {
    const url = `${neon}&channel_binding=require`;
    expect(withVerifyFull(url)).toBe(url.replace("sslmode=require", "sslmode=verify-full"));
    for (const same of [
      "postgres://localhost:5432/jane",
      "postgres://localhost/jane?sslmode=disable",
      "postgres://h/jane?sslmode=verify-full",
      "postgres://h/jane?sslmode=require&uselibpqcompat=true",
      "host=h dbname=jane sslmode=require",
    ]) {
      expect(withVerifyFull(same)).toBe(same);
    }
    expect(withVerifyFull(undefined)).toBeUndefined();
  });

  it("gives pg a checked TLS connection without the warning, where require warns", () => {
    const warn = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    const quiet = new pg.Client({ connectionString: withVerifyFull(neon) });
    expect((quiet as unknown as { ssl: unknown }).ssl).toEqual({});
    expect(warn).not.toHaveBeenCalled();
    new pg.Client({ connectionString: neon });
    expect(String(warn.mock.calls[0]?.[0])).toContain("SECURITY WARNING");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanForLog, log, logText, scrubConsole } from "@/lib/log";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const printed = (spy: { mock: { calls: unknown[][] } }) => JSON.stringify(spy.mock.calls);

describe("logText", () => {
  it("takes out tokens, emails and account numbers", () => {
    const text = logText(
      "failed for sam@example.com with access-sandbox-1234abcd and card 4111 1111 1111 1111",
    );
    expect(text).not.toContain("sam@example.com");
    expect(text).not.toContain("access-sandbox");
    expect(text).not.toContain("4111");
  });

  it("takes out what a statement line looks like in an error", () => {
    const text = logText(
      `Invalid value for description: "STARBUCKS STORE 12345" at row 4, amount $1,240.50`,
    );
    expect(text).not.toContain("STARBUCKS");
    expect(text).not.toContain("1,240");
    expect(text).toContain("at row 4");
  });

  it("removes a long quote whole, across the cut", () => {
    const secretWords = "CHECKING ACCT MEMO ".repeat(100);
    const text = logText(`${"x ".repeat(120)}"${secretWords}" and after`);
    expect(text).not.toContain("CHECKING");
    expect(text.length).toBeLessThanOrEqual(301);
  });

  it("removes a quote that never closes, with what follows it", () => {
    expect(logText(`bad row: "WHOLE FOODS #123 and more`)).toBe("bad row: [text]");
    expect(logText(`bad row: 'WHOLE FOODS #123 and more`)).toBe("bad row: [text]");
  });

  it("reads only so much of a huge text, and a quote cut there is still gone", () => {
    const text = logText(`start "${"RENT PAYMENT ".repeat(10_000)}" end`);
    expect(text).toBe("start [text]");
  });

  it("keeps apostrophes, ordinary words and status codes", () => {
    expect(logText("Error: couldn't reach the bank, HTTP 503")).toBe(
      "Error: couldn't reach the bank, HTTP 503",
    );
  });

  it("drops a link's query and long random strings", () => {
    const text = logText(
      `open https://jane.example/api/auth/callback?token=abc123&email=x then ${"a1".repeat(32)}`,
    );
    expect(text).toBe("open https://jane.example/api/auth/callback then [long]");
  });
});

describe("cleanForLog", () => {
  it("keeps ids, counts and reasons", () => {
    const fields = {
      userId: "cmabc123",
      status: 429,
      final: true,
      reason: "api_529",
      inputTokens: 900,
      name: "search_transactions",
      textLength: 40,
    };
    expect(cleanForLog(fields)).toEqual(fields);
  });

  it("drops fields named like credentials or a person's words, nested too", () => {
    expect(
      cleanForLog({
        accessToken: "a",
        access_token: "b",
        PLAID_SECRET: "c",
        rawDescription: "d",
        merchantName: "e",
        emailAddress: "f",
        question: "g",
        nested: { statementText: "h", more: [{ cookie: "i", ok: 1 }] },
      }),
    ).toEqual({
      accessToken: "[removed]",
      access_token: "[removed]",
      PLAID_SECRET: "[removed]",
      rawDescription: "[removed]",
      merchantName: "[removed]",
      emailAddress: "[removed]",
      question: "[removed]",
      nested: { statementText: "[removed]", more: [{ cookie: "[removed]", ok: 1 }] },
    });
  });

  it("keeps only an Error's name, message, code and status", () => {
    const error = Object.assign(new TypeError("boom"), {
      code: "ITEM_LOGIN_REQUIRED",
      status: 400,
      config: { data: JSON.stringify({ access_token: "access-production-abc" }) },
      response: { data: { description: "RENT" } },
    });
    expect(cleanForLog({ error })).toEqual({
      error: { name: "TypeError", message: "boom", code: "ITEM_LOGIN_REQUIRED", status: 400 },
    });
  });

  it("cuts off what goes too deep, and survives a loop", () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(JSON.stringify(cleanForLog(loop))).toContain("[removed]");
  });
});

describe("log", () => {
  it("writes the event and the cleaned detail at each level", () => {
    for (const level of ["error", "warn", "info"] as const) {
      const spy = vi.spyOn(console, level).mockImplementation(() => {});
      log[level]("Sync failed", { itemId: "i1", error: String(new Error("sam@example.com")) });
      expect(spy).toHaveBeenCalledWith("Sync failed", { itemId: "i1", error: "Error: [email]" });
    }
  });

  it("writes a measurement as one line of JSON", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    log.json("chat_timing", { totalMs: 12, prompt: "my rent" });
    expect(spy).toHaveBeenCalledWith("chat_timing", '{"totalMs":12,"prompt":"[removed]"}');
  });

  it("prints development lines outside production and nothing in production", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    log.dev("[dev] Magic link for sam@example.com: https://x/?token=1");
    expect(printed(spy)).toContain("Magic link");
    spy.mockClear();
    vi.stubEnv("NODE_ENV", "production");
    log.dev("[dev] Magic link for sam@example.com: https://x/?token=1");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("scrubConsole", () => {
  it("cleans what a library or the framework prints itself", () => {
    const lines: unknown[][] = [];
    const record = (...args: unknown[]) => void lines.push(args);
    const target = { log: record, info: record, warn: record, error: record, debug: record };
    scrubConsole(target);
    target.error(new Error(`Invalid value "PAYROLL ACME" for sam@example.com`));
    target.log("token access-production-abc123 for sam@example.com");
    target.info({ headers: { authorization: "Bearer abc" }, status: 500 });
    expect(JSON.stringify(lines)).not.toMatch(/PAYROLL|sam@example|access-production|Bearer abc/);
    expect(JSON.stringify(lines)).toContain('"status":500');
  });
});

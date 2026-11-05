import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTING_TOOLS, FakeRobinhood } from "./__fixtures__/fake-robinhood";
import {
  openReader,
  READ_TOOLS,
  RefusedToolError,
  RobinhoodReadError,
  RobinhoodSignedOutError,
  type ReadTool,
} from "./mcp-client";

describe("the allowlist", () => {
  let fake: FakeRobinhood;
  beforeEach(async () => {
    fake = await new FakeRobinhood().start();
    vi.stubEnv("ROBINHOOD_MCP_URL", fake.mcpUrl);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await fake.stop();
  });

  const reader = () => openReader({ accessToken: fake.issueTokensForTest().accessToken });

  it("is exactly these read tools, all of them readers", () => {
    expect([...READ_TOOLS]).toEqual([
      "get_accounts",
      "get_portfolio",
      "get_equity_positions",
      "get_equity_quotes",
      "get_equity_orders",
    ]);
    expect(READ_TOOLS.every((name) => name.startsWith("get_"))).toBe(true);
    expect(Object.isFrozen(READ_TOOLS)).toBe(true);
  });

  it("refuses place_equity_order before a single request is sent, though the server offers it", async () => {
    await expect(reader().read("place_equity_order" as ReadTool)).rejects.toThrow(RefusedToolError);
    expect(fake.requests).toEqual([]);
  });

  it("refuses every order, cancel, review, approval, alert and watchlist tool, and unknown ones", async () => {
    const r = reader();
    for (const name of [
      ...ACTING_TOOLS,
      "something_new",
      "",
      "get_accounts ",
      "GET_ACCOUNTS",
      "get_accounts/../place_equity_order",
      "__proto__",
      "constructor",
    ]) {
      await expect(r.read(name as ReadTool)).rejects.toThrow(RefusedToolError);
    }
    expect(fake.requests).toEqual([]);
  });

  it("refuses them after a good read too, and the server never hears the name", async () => {
    const r = reader();
    await r.read("get_accounts");
    const before = fake.requests.length;
    await expect(r.read("cancel_equity_order" as ReadTool)).rejects.toThrow(RefusedToolError);
    expect(fake.requests).toHaveLength(before);
    expect(fake.toolCalls()).toEqual(["get_accounts"]);
  });

  it("never asks for the tool list or any other method: only these", async () => {
    const r = reader();
    await r.read("get_accounts");
    await r.read("get_portfolio");
    expect(new Set(fake.requests.map((q) => q.rpc))).toEqual(
      new Set(["initialize", "notifications/initialized", "tools/call"]),
    );
  });
});

describe("talking to the server", () => {
  let fake: FakeRobinhood;
  beforeEach(async () => {
    fake = await new FakeRobinhood().start();
    vi.stubEnv("ROBINHOOD_MCP_URL", fake.mcpUrl);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await fake.stop();
  });

  const reader = () => openReader({ accessToken: fake.issueTokensForTest().accessToken });

  it("reads a JSON answer and an event stream alike", async () => {
    expect(await reader().read("get_portfolio")).toMatchObject({ total_value: "90000.00" });
    fake.options.eventStream = true;
    expect(await reader().read("get_portfolio")).toMatchObject({ total_value: "90000.00" });
  });

  it("says when the token isn't accepted", async () => {
    await expect(openReader({ accessToken: "wrong" }).read("get_accounts")).rejects.toThrow(
      RobinhoodSignedOutError,
    );
  });

  it("gives a code of its own for an error, with none of the server's words", async () => {
    fake.options.mcpStatus = 503;
    const error = await reader()
      .read("get_accounts")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RobinhoodReadError);
    expect((error as RobinhoodReadError).code).toBe("http_503");
  });

  it("won't follow a redirect, which could carry the token off", async () => {
    const other = await new FakeRobinhood().start();
    try {
      fake.options.redirectTo = `${other.origin}/steal`;
      const error = await reader()
        .read("get_accounts")
        .catch((e: unknown) => e);
      expect((error as RobinhoodReadError).code).toBe("unreachable");
      expect(other.requests).toEqual([]);
    } finally {
      await other.stop();
    }
  });

  it("gives up on an answer past the size limit", async () => {
    fake.options.answers = { get_accounts: "x".repeat(2_100_000) };
    const error = await reader()
      .read("get_accounts")
      .catch((e: unknown) => e);
    expect((error as RobinhoodReadError).code).toBe("too_large");
  });

  it("stops when the refresh's time is up", async () => {
    fake.options.delayMs = 2_000;
    const { accessToken } = fake.issueTokensForTest();
    const error = await openReader({ accessToken, signal: AbortSignal.timeout(50) })
      .read("get_accounts")
      .catch((e: unknown) => e);
    expect((error as RobinhoodReadError).code).toMatch(/timeout|unreachable/);
  });

  it("goes to Robinhood itself unless the override is on this machine", async () => {
    const { robinhoodServer, robinhoodAddressAllowed } = await import("@/config/robinhood");
    const official = robinhoodServer({ ROBINHOOD_MCP_URL: "https://evil.example.com/mcp" });
    expect(official.mcpUrl).toBe("https://agent.robinhood.com/mcp/trading");
    expect(robinhoodServer({ ROBINHOOD_MCP_URL: "http://127.0.0.1:9/mcp" }).mcpUrl).toContain(
      "127.0.0.1",
    );
    expect(robinhoodAddressAllowed("https://api.robinhood.com/oauth2/token/", {})).toBe(true);
    expect(robinhoodAddressAllowed("http://api.robinhood.com/oauth2/token/", {})).toBe(false);
    expect(robinhoodAddressAllowed("https://robinhood.com.evil.example/x", {})).toBe(false);
    expect(robinhoodAddressAllowed("https://evilrobinhood.com/x", {})).toBe(false);
  });
});

describe("no other code calls it", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    });
  const app = files("src").filter(
    (f) => /\.tsx?$/.test(f) && !f.includes(".test.") && !f.startsWith("src/generated"),
  );

  it("only the client module says tools/call", () => {
    const callers = app.filter((f) => readFileSync(f, "utf8").includes('"tools/call"'));
    expect(
      callers.filter((f) => !f.endsWith("src/lib/robinhood/__fixtures__/fake-robinhood.ts")),
    ).toEqual(["src/lib/robinhood/mcp-client.ts"]);
  });

  it("only the client module opens a reader, and only the refresh asks it", () => {
    const openers = app.filter((f) => /\bopenReader\b/.test(readFileSync(f, "utf8")));
    expect(openers.sort()).toEqual([
      "src/lib/robinhood/mcp-client.ts",
      "src/lib/robinhood/refresh.ts",
    ]);
  });

  it("the fake server is for tests: no app code imports it", () => {
    const importers = app.filter((f) => /from "[^"]*fake-robinhood"/.test(readFileSync(f, "utf8")));
    expect(importers).toEqual([]);
  });

  it("no acting tool's name appears in the app's code", () => {
    const named = app
      .filter((f) => !f.endsWith("src/lib/robinhood/__fixtures__/fake-robinhood.ts"))
      .filter((f) => ACTING_TOOLS.some((tool) => readFileSync(f, "utf8").includes(`"${tool}"`)));
    expect(named).toEqual([]);
  });
});

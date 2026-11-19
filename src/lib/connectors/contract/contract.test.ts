import { describe, expect, it, vi } from "vitest";
import { METHOD_DOCS_ACCOUNTS } from "../method/sample";
import { CONTRACT_HOSTS, HostRefused, guardedFetch } from "./guard";
import { methodContract } from "./method";
import { NotLocal, runContracts } from "./index";
import { formatContract, shapeMismatches } from "./shape";
import { snaptradeContract } from "./snaptrade";

// The contract run's rules, with fakes (the run itself is contract.proof.test.ts, local only).

describe("the contract run's guard", () => {
  it("calls only test hosts: never Method's production or its live-data Sandbox", async () => {
    const send = vi.fn(async () => new Response(null));
    const guarded = guardedFetch(send as never);
    await guarded("https://dev.methodfi.com/accounts");
    for (const host of [
      "https://production.methodfi.com/accounts",
      "https://sandbox.methodfi.com/accounts",
      "https://api.dwolla.com/token",
      "https://api.getpinwheel.com/v1/x",
      "https://example.com/",
    ]) {
      await expect(guarded(host)).rejects.toBeInstanceOf(HostRefused);
    }
    expect(send).toHaveBeenCalledTimes(1);
    expect(CONTRACT_HOSTS).not.toContain("https://production.methodfi.com");
  });

  it("is local only: refused under CI", async () => {
    await expect(runContracts({ CI: "true" })).rejects.toBeInstanceOf(NotLocal);
  });
});

describe("what the contract run reports", () => {
  it("names a missing field or another shape, never a value", () => {
    expect(
      shapeMismatches(
        { id: 7, update: { source: "direct" } },
        { id: "string", name: "string?", update: { type: "string" } },
      ),
    ).toEqual(["id: expected string, got number", "update.type: missing"]);
    const line = formatContract({
      connector: "x",
      reachable: true,
      parsed: true,
      created: ["entity"],
      mismatches: ["a.b: missing"],
      note: "",
    });
    expect(line).toBe("x: reachable yes, parsed yes, made test entity, mismatches: a.b: missing");
  });
});

describe("Method's contract, against its documented example", () => {
  it("makes the documented test entity, verifies it, simulates and reads through the adapter", async () => {
    const paths: string[] = [];
    const send = vi.fn(async (url: string) => {
      const { pathname } = new URL(url);
      paths.push(pathname);
      if (pathname === "/entities") return Response.json({ data: { id: "ent_test1234" } });
      if (pathname === "/accounts") return Response.json({ data: METHOD_DOCS_ACCOUNTS });
      return Response.json({ data: {} });
    });
    const result = await methodContract({ METHOD_API_KEY: "k" }, guardedFetch(send as never));
    expect(paths).toEqual([
      "/entities",
      "/entities/ent_test1234/verification_sessions",
      "/entities/ent_test1234/verification_sessions",
      "/simulate/entities/ent_test1234/connect",
      "/entities/ent_test1234/connect",
      "/accounts",
    ]);
    expect(result).toMatchObject({ reachable: true, parsed: true, mismatches: [] });
    expect(result.created).toEqual(["entity (Method's documented example person)"]);
    expect(result.note).toBe("3 accounts read, 3 kept (auto, credit card, student)");
  });

  it("names a field Method sent in another shape", async () => {
    const odd = [{ ...METHOD_DOCS_ACCOUNTS[1]!, liability: { type: 5 } }];
    const send = vi.fn(async (url: string) =>
      new URL(url).pathname === "/accounts"
        ? Response.json({ data: odd })
        : Response.json({ data: { id: "ent_test1234" } }),
    );
    const result = await methodContract({ METHOD_API_KEY: "k" }, guardedFetch(send as never));
    expect(result.mismatches).toContain("accounts[0].liability.type: expected string, got number");
  });
});

describe("SnapTrade's contract", () => {
  it("registers a test user, reads its link and accounts, and deletes it", async () => {
    const calls: string[] = [];
    const send = vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      calls.push(`${init?.method ?? "GET"} ${u.pathname}`);
      if (u.pathname === "/snapTrade/registerUser") {
        return Response.json({ userId: JSON.parse(String(init?.body)).userId, userSecret: "s" });
      }
      if (u.pathname === "/snapTrade/login")
        return Response.json({ redirectURI: "https://app.snaptrade.com/x" });
      if (u.pathname === "/accounts/all") return Response.json({ results: [] });
      return new Response(null, { status: 200 });
    });
    const result = await snaptradeContract(
      { SNAPTRADE_CLIENT_ID: "c", SNAPTRADE_CONSUMER_KEY: "k" },
      guardedFetch(send as never),
    );
    expect(calls).toEqual([
      "POST /snapTrade/registerUser",
      "POST /snapTrade/login",
      "GET /accounts/all",
      "DELETE /snapTrade/deleteUser",
    ]);
    expect(result).toMatchObject({ reachable: true, parsed: true, mismatches: [] });
    expect(result.note).toContain("test user deleted yes");
  });
});

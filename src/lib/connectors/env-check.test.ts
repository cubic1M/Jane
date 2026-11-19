import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  ALPACA,
  CANOPY,
  CHART,
  METHOD,
  PINWHEEL,
  POSTGRID,
  SIGNWELL,
  SNAPTRADE,
} from "@/config/connectors";
import { DWOLLA_SANDBOX } from "@/config/money-movement";
import { RETELL } from "@/config/retell";
import { TEST_HOSTS, VENDOR_CHECKS, checkConnectorEnv, formatCheck } from "./env-check";

// `npm run connectors:check` (section C3): names and yes or no only, test hosts only.

const keysOf = (vendor: string) => VENDOR_CHECKS.find((c) => c.vendor === vendor)?.keys ?? [];

describe("connectors:check's key names", () => {
  it("are the names the adapters read", () => {
    expect(keysOf("Method")).toEqual([METHOD.apiKeyEnv, METHOD.webhookSecretEnv]);
    expect(keysOf("Dwolla")).toEqual([DWOLLA_SANDBOX.keyEnv, DWOLLA_SANDBOX.secretEnv]);
    expect(keysOf("Pinwheel")).toEqual([PINWHEEL.apiSecretEnv]);
    expect(keysOf("PostGrid")).toEqual([POSTGRID.testApiKeyEnv, POSTGRID.webhookSecretEnv]);
    expect(keysOf("SnapTrade")).toEqual([SNAPTRADE.clientIdEnv, SNAPTRADE.consumerKeyEnv]);
    expect(keysOf("Retell")).toEqual([RETELL.apiKeyEnv, RETELL.agentIdEnv, RETELL.fromNumberEnv]);
    expect(keysOf("Canopy")).toEqual([
      CANOPY.clientIdEnv,
      CANOPY.clientSecretEnv,
      CANOPY.teamIdEnv,
    ]);
    expect(keysOf("Chart")).toEqual([CHART.clientIdEnv, CHART.clientSecretEnv]);
    expect(keysOf("SignWell")).toEqual([SIGNWELL.apiKeyEnv, SIGNWELL.webhookIdEnv]);
    expect(keysOf("Alpaca (broker sandbox)")).toEqual([ALPACA.keyEnv, ALPACA.secretEnv]);
  });

  it("are all in .env.example", () => {
    const example = readFileSync(".env.example", "utf8");
    for (const check of VENDOR_CHECKS) {
      for (const name of check.keys) expect(example, name).toMatch(new RegExp(`^${name}=`, "m"));
    }
  });
});

describe("connectors:check", () => {
  const SECRET = "s3cr3t-value-never-printed";
  const env = Object.fromEntries(
    VENDOR_CHECKS.flatMap((c) => c.keys).map((name) => [name, `${SECRET}-${name}`]),
  );

  it("prints names and yes or no, never a value", async () => {
    const send = vi.fn(async () => new Response(null, { status: 404 }));
    const lines = await checkConnectorEnv(
      { ...env, POSTGRID_TEST_API_KEY: `test_${SECRET}` },
      { fetch: send as never },
    );
    const text = lines.map(formatCheck).join("\n");
    expect(text).not.toContain(SECRET);
    expect(text).toContain("METHOD_API_KEY set");
    expect(text).toContain(
      "Method: METHOD_API_KEY set, METHOD_WEBHOOK_HMAC_SECRET set. Test environment: yes (HTTP 404)",
    );
  });

  it("calls only test hosts: Method's Development whatever METHOD_ENV says", async () => {
    const send = vi.fn(async (_url: string) => new Response(null, { status: 200 }));
    await checkConnectorEnv(
      { ...env, METHOD_ENV: "production", POSTGRID_TEST_API_KEY: "test_x" },
      { fetch: send as never },
    );
    const hosts = send.mock.calls.map(([u]) => new URL(String(u)).origin);
    expect(hosts.length).toBeGreaterThan(0);
    for (const host of hosts) expect(TEST_HOSTS).toContain(host);
    expect(hosts).toContain("https://dev.methodfi.com");
    expect(hosts.join(" ")).not.toMatch(
      /production\.methodfi|api\.dwolla\.com|api\.getpinwheel|snaptrade|retell/,
    );
  });

  it("refuses PostGrid's live key, says no on a refusal, and calls nothing with keys missing or --names", async () => {
    const send = vi.fn(async () => new Response(null, { status: 401 }));
    const lines = await checkConnectorEnv(
      { ...env, POSTGRID_TEST_API_KEY: "live_sk_x" },
      { fetch: send as never },
    );
    expect(lines.find((l) => l.vendor === "PostGrid")?.reach).toBe(
      "refused: not a test key, not called",
    );
    expect(lines.find((l) => l.vendor === "Method")?.reach).toBe("no (HTTP 401)");
    // The test call needs only the keys it uses: Method's API key, not its webhook secret.
    const keyOnly = await checkConnectorEnv(
      { METHOD_API_KEY: "k" },
      { fetch: vi.fn(async () => new Response(null, { status: 200 })) as never },
    );
    expect(keyOnly.find((l) => l.vendor === "Method")?.reach).toBe("yes (HTTP 200)");
    const none = vi.fn();
    const empty = await checkConnectorEnv({}, { fetch: none as never });
    expect(empty.every((l) => !l.reach.startsWith("yes"))).toBe(true);
    await checkConnectorEnv(env, { reach: false, fetch: none as never });
    expect(none).not.toHaveBeenCalled();
  });
});

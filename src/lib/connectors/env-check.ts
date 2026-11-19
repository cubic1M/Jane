// `npm run connectors:check` (section C3): for each connector, whether its key names are set and
// whether its vendor's TEST environment accepts them. Prints names and yes or no only, never a value.
// Calls only test hosts: Method's Development (its "Sandbox" is live data), Dwolla's Sandbox, Pinwheel's
// Sandbox, and PostGrid with a test key; a vendor with one host for test and live keys (SnapTrade,
// Retell) is checked by name only. Self-contained (no "@/" imports) so plain node runs it; the key
// names are held to src/config by env-check.test.ts.

type Env = Record<string, string | undefined>;
type Reach = (env: Env, send: typeof fetch) => Promise<Response>;

export type VendorCheck = {
  vendor: string;
  keys: readonly string[];
  // The test host it calls, and the call; none when it can't tell test from live.
  // `needs`: the keys the test call itself uses (a webhook secret isn't one).
  test?: {
    host: string;
    needs: readonly string[];
    reach: Reach;
    refuse?: (env: Env) => string | null;
  };
  noReachReason?: string;
};

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

export const VENDOR_CHECKS: readonly VendorCheck[] = [
  {
    vendor: "Method",
    keys: ["METHOD_API_KEY", "METHOD_WEBHOOK_HMAC_SECRET"],
    test: {
      host: "https://dev.methodfi.com",
      needs: ["METHOD_API_KEY"],
      reach: (env, send) =>
        send("https://dev.methodfi.com/accounts?page_limit=1", {
          headers: {
            authorization: `Bearer ${env.METHOD_API_KEY}`,
            "method-version": "2026-03-30",
          },
        }),
    },
  },
  {
    vendor: "Dwolla",
    keys: ["DWOLLA_SANDBOX_KEY", "DWOLLA_SANDBOX_SECRET"],
    test: {
      host: "https://api-sandbox.dwolla.com",
      needs: ["DWOLLA_SANDBOX_KEY", "DWOLLA_SANDBOX_SECRET"],
      reach: (env, send) =>
        send("https://api-sandbox.dwolla.com/token", {
          method: "POST",
          headers: {
            authorization: `Basic ${Buffer.from(`${env.DWOLLA_SANDBOX_KEY}:${env.DWOLLA_SANDBOX_SECRET}`).toString("base64")}`,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: "grant_type=client_credentials",
        }),
    },
  },
  {
    vendor: "Pinwheel",
    keys: ["PINWHEEL_API_SECRET"],
    test: {
      host: "https://sandbox.getpinwheel.com",
      needs: ["PINWHEEL_API_SECRET"],
      // An account that can't exist: 404 means the secret was accepted, 401 that it wasn't.
      reach: (env, send) =>
        send(`https://sandbox.getpinwheel.com/v1/accounts/${UNKNOWN_ID}/employment`, {
          headers: {
            "x-api-secret": env.PINWHEEL_API_SECRET ?? "",
            "Pinwheel-Version": "2025-07-08",
          },
        }),
    },
  },
  {
    vendor: "PostGrid",
    keys: ["POSTGRID_TEST_API_KEY", "POSTGRID_WEBHOOK_SECRET"],
    test: {
      host: "https://api.postgrid.com",
      needs: ["POSTGRID_TEST_API_KEY"],
      refuse: (env) =>
        /^test_/.test(env.POSTGRID_TEST_API_KEY ?? "") ? null : "not a test key, not called",
      reach: (env, send) =>
        send("https://api.postgrid.com/print-mail/v1/letters?limit=1", {
          headers: { "x-api-key": env.POSTGRID_TEST_API_KEY ?? "" },
        }),
    },
  },
  {
    vendor: "SnapTrade",
    keys: ["SNAPTRADE_CLIENT_ID", "SNAPTRADE_CONSUMER_KEY"],
    noReachReason: "one host for test and live keys",
  },
  {
    vendor: "Retell",
    keys: ["RETELL_API_KEY", "RETELL_AGENT_ID", "RETELL_FROM_NUMBER"],
    noReachReason: "no test environment",
  },
  { vendor: "Canopy", keys: ["CANOPY_CLIENT_ID", "CANOPY_CLIENT_SECRET", "CANOPY_TEAM_ID"] },
  { vendor: "Chart", keys: ["CHART_CLIENT_ID", "CHART_CLIENT_SECRET"] },
  { vendor: "SignWell", keys: ["SIGNWELL_API_KEY", "SIGNWELL_WEBHOOK_ID"] },
  { vendor: "Alpaca (broker sandbox)", keys: ["ALPACA_BROKER_KEY_ID", "ALPACA_BROKER_SECRET_KEY"] },
];

// Hosts the check may call. Anything else is refused before a request is made.
export const TEST_HOSTS = [
  "https://dev.methodfi.com",
  "https://api-sandbox.dwolla.com",
  "https://sandbox.getpinwheel.com",
  "https://api.postgrid.com",
] as const;

export type CheckLine = { vendor: string; keys: { name: string; set: boolean }[]; reach: string };

export async function checkConnectorEnv(
  env: Env,
  { reach = true, fetch: send = fetch }: { reach?: boolean; fetch?: typeof fetch } = {},
): Promise<CheckLine[]> {
  const lines: CheckLine[] = [];
  for (const check of VENDOR_CHECKS) {
    const keys = check.keys.map((name) => ({ name, set: Boolean(env[name]?.trim()) }));
    let result = "not checked";
    if (!check.test) {
      result = check.noReachReason ? `not checked: ${check.noReachReason}` : "not checked";
    } else if (!check.test.needs.every((name) => env[name]?.trim())) {
      result = "not checked: keys missing";
    } else if (!(TEST_HOSTS as readonly string[]).includes(check.test.host)) {
      result = "refused: not a test host";
    } else if (check.test.refuse?.(env)) {
      result = `refused: ${check.test.refuse(env)}`;
    } else if (reach) {
      try {
        const response = await check.test.reach(env, send);
        const refused = response.status === 401 || response.status === 403;
        result = refused ? `no (HTTP ${response.status})` : `yes (HTTP ${response.status})`;
      } catch {
        result = "no (unreachable)";
      }
    }
    lines.push({ vendor: check.vendor, keys, reach: result });
  }
  return lines;
}

// One line per vendor: names with set or missing, then the test call's answer. No values, ever.
export const formatCheck = (line: CheckLine) =>
  `${line.vendor}: ${line.keys.map((k) => `${k.name} ${k.set ? "set" : "missing"}`).join(", ")}. Test environment: ${line.reach}`;

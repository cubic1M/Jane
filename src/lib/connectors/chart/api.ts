import { CHART } from "@/config/connectors";

// Chart's API, the parts Jane reads (developer.trychart.com, its quickstart and OpenAPI definition,
// developer.trychart.com/api-reference/openapi.json, read 2026-11-17): POST /auth/token turns the
// code Chart Connect hands back into the taxpayer's access_token; GET /records, with that token as
// the bearer and the Chart-API-Version header, lists their tax records, each with its parsed forms.
// An account transcript is a form of type "ACTR": its year, the account summary and each
// transaction's IRS code, date and amount, in dollars. Only the fields Jane uses are typed here.

export type ChartTransaction = {
  code: string;
  explanation_of_transaction: string;
  cycle?: string | null;
  date?: string | null;
  amount: number;
};

export type ChartAccountTranscript = {
  type: "ACTR";
  year: string;
  account_summary?: { account_balance?: number | null } | null;
  transactions?: ChartTransaction[] | null;
};

export type ChartRecord = {
  id: string;
  tax_year: string;
  provider_id?: string | null;
  // Other kinds of form (returns, W-2s, wage and income) are left out.
  forms?: ({ type?: string } & Record<string, unknown>)[] | null;
};

export type ChartLink = { taxpayerId: string; providerId: string; accessToken: string };

export interface ChartApi {
  exchangeCode(code: string, redirectUri: string | null): Promise<ChartLink>;
  records(accessToken: string): Promise<ChartRecord[]>;
}

// Chart said no (its HTTP status) or keys aren't set. Never carries a token, a key or the body.
export class ChartError extends Error {
  constructor(
    readonly status: number | null,
    readonly code: string,
  ) {
    super(`Chart request failed: ${code}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "ChartError";
  }
}

type HttpOptions = { env?: Record<string, string | undefined>; fetch?: typeof fetch };

export function chartHttp({ env = process.env, fetch: send = fetch }: HttpOptions = {}): ChartApi {
  const headers = { accept: "application/json", "chart-api-version": CHART.apiVersion };
  return {
    async exchangeCode(code, redirectUri) {
      const clientId = env[CHART.clientIdEnv];
      const clientSecret = env[CHART.clientSecretEnv];
      if (!clientId || !clientSecret) throw new ChartError(null, "NOT_CONFIGURED");
      const response = await send(`${CHART.baseUrl}/auth/token`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          ...(redirectUri ? { redirect_uri: redirectUri } : {}),
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        taxpayer_id?: unknown;
        provider_id?: unknown;
        access_token?: unknown;
      } | null;
      if (!response.ok || typeof body?.access_token !== "string") {
        throw new ChartError(response.status, "TOKEN_REFUSED");
      }
      return {
        taxpayerId: String(body.taxpayer_id ?? ""),
        providerId: String(body.provider_id ?? ""),
        accessToken: body.access_token,
      };
    },
    async records(accessToken) {
      const response = await send(`${CHART.baseUrl}/records`, {
        headers: { ...headers, authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) throw new ChartError(response.status, "REFUSED");
      const body = (await response.json().catch(() => null)) as unknown;
      if (!Array.isArray(body)) throw new ChartError(response.status, "UNREADABLE");
      return body.filter(
        (r): r is ChartRecord => typeof r === "object" && r !== null && typeof r.id === "string",
      );
    },
  };
}

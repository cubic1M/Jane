import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

// The Plaid API client, configured from env. PLAID_ENV defaults to sandbox, so nothing
// talks to real banks unless production is chosen explicitly.

let client: PlaidApi | undefined;

export function plaidEnabled(): boolean {
  return Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

// Plaid Investments (holdings and investment transactions, read-only) is billed per item and
// must be turned on in the Plaid dashboard first, so it stays off unless PLAID_INVESTMENTS=1.
// The demo bank's stand-in investments don't need it.
export function plaidInvestmentsEnabled(): boolean {
  return process.env.PLAID_INVESTMENTS === "1";
}

export function plaidEnvironment(): "sandbox" | "production" {
  return process.env.PLAID_ENV === "production" ? "production" : "sandbox";
}

export function plaid(): PlaidApi {
  client ??= new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[plaidEnvironment()],
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID ?? "",
          "PLAID-SECRET": process.env.PLAID_SECRET ?? "",
        },
      },
    }),
  );
  return client;
}

// A failed Plaid call, stripped down to what's safe to log. The SDK's own error carries
// the request (access token in the body, our secret in the headers), so it must never
// reach a log or a response.
export class PlaidRequestError extends Error {
  constructor(
    readonly code: string | null,
    readonly status: number | null,
  ) {
    super(`Plaid request failed${code ? `: ${code}` : ""}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "PlaidRequestError";
  }
}

// Every Plaid SDK call goes through here so failures come back as PlaidRequestError.
export async function plaidCall<T>(request: Promise<{ data: T }>): Promise<T> {
  try {
    return (await request).data;
  } catch (error) {
    const response = (error as { response?: { status?: unknown; data?: { error_code?: unknown } } })
      ?.response;
    if (!response) {
      // No answer from Plaid: keep only the network reason (e.g. ECONNRESET), which is safe.
      const reason = (error as { code?: unknown })?.code;
      throw new PlaidRequestError(typeof reason === "string" ? `NETWORK_${reason}` : null, null);
    }
    throw new PlaidRequestError(
      typeof response.data?.error_code === "string" ? response.data.error_code : null,
      typeof response.status === "number" ? response.status : null,
    );
  }
}

// Plaid's error code from a failed call, if it was a Plaid API error.
export function plaidErrorCode(error: unknown): string | null {
  return error instanceof PlaidRequestError ? error.code : null;
}

// Where Plaid sends webhooks. APP_URL wins; on Vercel the production domain is the default.
export function webhookUrl(): string | undefined {
  const base =
    process.env.APP_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined);
  return base ? `${base.replace(/\/$/, "")}/api/plaid/webhook` : undefined;
}

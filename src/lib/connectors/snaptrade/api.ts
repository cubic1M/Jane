import { createHmac } from "node:crypto";
import { SNAPTRADE } from "@/config/connectors";
import { canonicalJson } from "../canonical-json";

// SnapTrade's API, the part Jane uses (docs.snaptrade.com, read 2026-11-19: Request Signatures,
// Register User, Generate Connection Portal URL, List All User Accounts, List All Account Positions,
// Sandbox, and the public OpenAPI definition). A SnapTrade user per person (Jane makes up its id, never
// the person's own), whose secret stays in the vault; the Connection Portal link asks for a read
// connection only. Only the fields Jane uses are typed here.

export type SnaptradeUser = { userId: string; userSecret: string };

type Money = { amount?: number | null; currency?: string | null } | null;

export type SnaptradeAccount = {
  kind: string;
  id: string;
  connection_id?: string | null;
  status?: string | null;
  display_name?: string | null;
  masked_account_number?: string | null;
  raw_type?: string | null;
  is_paper?: boolean | null;
  net_value?: Money;
};

export type SnaptradeInstrument = {
  kind: string;
  id?: string | null;
  symbol?: string | null;
  raw_symbol?: string | null;
  description?: string | null;
  currency?: string | null;
};

export type SnaptradePosition = {
  instrument: SnaptradeInstrument;
  // Decimal strings.
  units?: string | null;
  price?: string | null;
  // Per share.
  cost_basis?: string | null;
  currency?: string | null;
  cash_equivalent?: boolean | null;
};

export type SnaptradePositions = {
  results: SnaptradePosition[];
  data_freshness?: { as_of?: string | null } | null;
};

export interface SnaptradeApi {
  registerUser(userId: string): Promise<SnaptradeUser>;
  // The Connection Portal URL, for a read-only connection.
  connectLink(
    user: SnaptradeUser,
    options?: { broker?: string; customRedirect?: string },
  ): Promise<string>;
  accounts(user: SnaptradeUser): Promise<SnaptradeAccount[]>;
  positions(user: SnaptradeUser, accountId: string): Promise<SnaptradePositions>;
}

// SnapTrade said no (its HTTP status) or the keys aren't set. Never carries a key, a user secret or
// the body.
export class SnaptradeError extends Error {
  constructor(
    readonly status: number | null,
    readonly code: string,
  ) {
    super(`SnapTrade request failed: ${code}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "SnaptradeError";
  }
}

const ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const BROKER = /^[A-Z0-9_]{2,40}$/;

// The `Signature` header for one request: HMAC-SHA256 with the consumer key over the canonical JSON
// of { content, path, query }, base64. `query` is exactly as sent, without "?"; no body is null.
export function requestSignature(
  consumerKey: string,
  path: string,
  query: string,
  body: unknown,
): string {
  const content =
    body === undefined || (body && typeof body === "object" && !Object.keys(body).length)
      ? null
      : body;
  return createHmac("sha256", consumerKey)
    .update(canonicalJson({ content, path, query }))
    .digest("base64");
}

type HttpOptions = {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  now?: () => Date;
};

export function snaptradeHttp({
  env = process.env,
  fetch: send = fetch,
  now = () => new Date(),
}: HttpOptions = {}): SnaptradeApi {
  async function call(
    method: "GET" | "POST",
    path: string,
    params: Record<string, string>,
    body?: unknown,
  ): Promise<unknown> {
    const clientId = env[SNAPTRADE.clientIdEnv];
    const consumerKey = env[SNAPTRADE.consumerKeyEnv];
    if (!clientId || !consumerKey) throw new SnaptradeError(null, "NOT_CONFIGURED");
    const query = new URLSearchParams({
      clientId,
      timestamp: String(Math.floor(now().getTime() / 1000)),
      ...params,
    }).toString();
    const response = await send(`${SNAPTRADE.baseUrl}${path}?${query}`, {
      method,
      headers: {
        [SNAPTRADE.signatureHeader]: requestSignature(consumerKey, path, query, body),
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const parsed = (await response.json().catch(() => null)) as unknown;
    if (!response.ok || parsed === null) throw new SnaptradeError(response.status, "REFUSED");
    return parsed;
  }
  const as = (user: SnaptradeUser) => {
    if (!ID.test(user.userId)) throw new SnaptradeError(null, "BAD_ID");
    return { userId: user.userId, userSecret: user.userSecret };
  };

  return {
    async registerUser(userId) {
      if (!ID.test(userId)) throw new SnaptradeError(null, "BAD_ID");
      const body = (await call("POST", "/snapTrade/registerUser", {}, { userId })) as {
        userId?: unknown;
        userSecret?: unknown;
      };
      if (body.userId !== userId || typeof body.userSecret !== "string") {
        throw new SnaptradeError(null, "SHAPE");
      }
      return { userId, userSecret: body.userSecret };
    },
    async connectLink(user, { broker, customRedirect } = {}) {
      if (broker !== undefined && !BROKER.test(broker))
        throw new SnaptradeError(null, "BAD_BROKER");
      if (customRedirect !== undefined && !/^https?:\/\/\S+$/.test(customRedirect)) {
        throw new SnaptradeError(null, "BAD_REDIRECT");
      }
      const body = (await call("POST", "/snapTrade/login", as(user), {
        connectionType: SNAPTRADE.connectionType,
        ...(broker ? { broker } : {}),
        ...(customRedirect ? { customRedirect } : {}),
      })) as { redirectURI?: unknown };
      const url = typeof body.redirectURI === "string" ? body.redirectURI : "";
      if (!url.startsWith("https://")) throw new SnaptradeError(null, "SHAPE");
      return url;
    },
    async accounts(user) {
      const body = (await call("GET", "/accounts/all", as(user))) as { results?: unknown };
      if (!Array.isArray(body.results)) throw new SnaptradeError(null, "SHAPE");
      // Never part of a list: a refresh that saw only the first accounts would remove the rest.
      if (body.results.length > SNAPTRADE.maxAccounts) throw new SnaptradeError(null, "TOO_MANY");
      return body.results as SnaptradeAccount[];
    },
    async positions(user, accountId) {
      if (!ID.test(accountId)) throw new SnaptradeError(null, "BAD_ID");
      const body = (await call(
        "GET",
        `/accounts/${accountId}/positions/all`,
        as(user),
      )) as SnaptradePositions;
      if (!Array.isArray(body.results)) throw new SnaptradeError(null, "SHAPE");
      return body;
    },
  };
}

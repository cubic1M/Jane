import { AKOYA } from "@/config/connectors";

// Akoya's API, the parts Jane reads (docs.akoya.com/reference, read 2026-11-17):
// - POST {idp}/token, grant_type=refresh_token with client_id and client_secret in the body, for a
//   fresh id_token (the bearer for data calls) and, sometimes, a new refresh token;
// - GET {products}/accounts-info/v3/{providerId}: the accounts the person shared, each wrapped by
//   its type (depositAccount, investmentAccount, ...), with accountId and accountNumberDisplay;
// - GET {products}/tax-forms/v3/{providerId}?accountId=&taxYear=: the account's tax statements,
//   each with its forms; a form has its type (taxFormType, e.g. "Tax1099Int") and one object for
//   that type (tax1099Int, ...), amounts in dollars.
// Every data call says how it's made (x-akoya-interaction-type BATCH: Jane collects once a day),
// when the person last used Jane (x-akoya-last-access) and that it isn't about payments
// (x-akoya-intent-type nonpayments). Only the fields Jane uses are typed here.

export type AkoyaAccount = {
  accountId: string;
  accountType?: string | null;
  accountNumberDisplay?: string | null;
  nickname?: string | null;
  status?: string | null;
};

type Dollars = number | null | undefined;

export type AkoyaSale = {
  salesPrice?: Dollars;
  costBasis?: Dollars;
  washSaleLossDisallowed?: Dollars;
  // SHORT or LONG term.
  longOrShort?: string | null;
};

export type AkoyaTaxForm = {
  taxYear?: number;
  accountId?: string | null;
  taxFormType: string;
  corrected?: boolean | null;
  tax1099Int?: { interestIncome?: Dollars; federalTaxWithheld?: Dollars };
  tax1099Div?: { ordinaryDividends?: Dollars; qualifiedDividends?: Dollars };
  tax1099B?: { securityDetails?: AkoyaSale[] };
  tax1099R?: { grossDistribution?: Dollars; taxableAmount?: Dollars; federalTaxWithheld?: Dollars };
  tax1099G?: { unemploymentCompensation?: Dollars; federalTaxWithheld?: Dollars };
  tax1099Nec?: { nonEmployeeCompensation?: Dollars; federalTaxWithheld?: Dollars };
  tax1098?: { mortgageInterest?: Dollars; pointsPaid?: Dollars };
  tax1098E?: { studentLoanInterest?: Dollars };
};

export type AkoyaStatement = {
  taxYear?: number;
  taxStatementId?: string | null;
  forms: AkoyaTaxForm[];
};

export type AkoyaTokens = { idToken: string; refreshToken: string | null };

export interface AkoyaApi {
  refresh(refreshToken: string): Promise<AkoyaTokens>;
  accounts(idToken: string, providerId: string, lastAccess: Date): Promise<AkoyaAccount[]>;
  taxStatements(
    idToken: string,
    providerId: string,
    accountId: string,
    taxYear: number,
    lastAccess: Date,
  ): Promise<AkoyaStatement[]>;
}

// Akoya said no (its HTTP status) or keys aren't set. Never carries a token, a key or the body.
export class AkoyaError extends Error {
  constructor(
    readonly status: number | null,
    readonly code: string,
  ) {
    super(`Akoya request failed: ${code}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "AkoyaError";
  }
}

// Akoya's ids are its own short strings; anything that could change the path is refused.
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

type HttpOptions = { env?: Record<string, string | undefined>; fetch?: typeof fetch };

export function akoyaHttp({ env = process.env, fetch: send = fetch }: HttpOptions = {}): AkoyaApi {
  const hosts = env[AKOYA.envEnv] === "production" ? AKOYA.production : AKOYA.sandbox;
  const keys = () => {
    const id = env[AKOYA.clientIdEnv];
    const secret = env[AKOYA.clientSecretEnv];
    if (!id || !secret) throw new AkoyaError(null, "NOT_CONFIGURED");
    return { id, secret };
  };
  const data = async (path: string, idToken: string, lastAccess: Date) => {
    keys();
    const response = await send(`${hosts.products}${path}`, {
      headers: {
        authorization: `Bearer ${idToken}`,
        accept: "application/json",
        "x-akoya-interaction-type": "BATCH",
        "x-akoya-last-access": lastAccess.toISOString().replace(/\.\d{3}Z$/, "Z"),
        "x-akoya-intent-type": "nonpayments",
      },
    });
    if (!response.ok) throw new AkoyaError(response.status, "REFUSED");
    return response.json().catch(() => {
      throw new AkoyaError(response.status, "UNREADABLE");
    }) as Promise<Record<string, unknown>>;
  };
  const checkIds = (...ids: string[]) => {
    if (!ids.every((id) => SAFE_ID.test(id))) throw new AkoyaError(null, "BAD_ID");
  };
  return {
    async refresh(refreshToken) {
      const { id, secret } = keys();
      const response = await send(hosts.token, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: id,
          client_secret: secret,
        }).toString(),
      });
      const body = (await response.json().catch(() => null)) as {
        id_token?: unknown;
        refresh_token?: unknown;
      } | null;
      if (!response.ok || typeof body?.id_token !== "string") {
        throw new AkoyaError(response.status, "TOKEN_REFUSED");
      }
      return {
        idToken: body.id_token,
        refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
      };
    },
    async accounts(idToken, providerId, lastAccess) {
      checkIds(providerId);
      const body = await data(`/accounts-info/${AKOYA.version}/${providerId}`, idToken, lastAccess);
      const wrapped = Array.isArray(body.accounts) ? (body.accounts as unknown[]) : [];
      // Each is { depositAccount: {...} } or { investmentAccount: {...} } and so on.
      return wrapped.flatMap((entry) =>
        Object.values((entry ?? {}) as Record<string, unknown>).flatMap((a) =>
          a && typeof a === "object" && typeof (a as AkoyaAccount).accountId === "string"
            ? [a as AkoyaAccount]
            : [],
        ),
      );
    },
    async taxStatements(idToken, providerId, accountId, taxYear, lastAccess) {
      checkIds(providerId, accountId);
      const query = new URLSearchParams({ accountId, taxYear: String(taxYear) });
      const body = await data(
        `/tax-forms/${AKOYA.version}/${providerId}?${query}`,
        idToken,
        lastAccess,
      );
      const statements = Array.isArray(body.statements) ? (body.statements as unknown[]) : [];
      return statements.flatMap((s) =>
        s && typeof s === "object" && Array.isArray((s as AkoyaStatement).forms)
          ? [s as AkoyaStatement]
          : [],
      );
    },
  };
}

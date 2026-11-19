import { METHOD } from "@/config/connectors";

// Method's API, the part Jane reads (docs.methodfi.com, API reference 2026-03-30: List all Accounts,
// the Update object, Pagination, Authentication and Environments, read 2026-11-19): a person's
// liability accounts (GET /accounts?holder_id=&type=liability&status=active) with each one's newest
// Update expanded (expand[]=update, sort[update]=-data_as_of). An Update carries the account's
// figures under its liability type (credit_card, auto_loan, mortgage, personal_loan,
// student_loans), amounts in cents, and says whether they came from the institution ("direct") or
// the credit report ("snapshot"). Only the fields Jane uses are typed here.

type Cents = number | null | undefined;
type Day = string | null | undefined;

export type MethodLiabilityData = {
  balance?: Cents;
  credit_limit?: Cents;
  interest_rate_percentage?: number | null;
  interest_rate_percentage_min?: number | null;
  interest_rate_percentage_max?: number | null;
  interest_rate_type?: string | null;
  last_payment_amount?: Cents;
  last_payment_date?: Day;
  next_payment_due_date?: Day;
  next_payment_minimum_amount?: Cents;
  opened_at?: Day;
  closed_at?: Day;
  expected_payoff_date?: Day;
  original_loan_amount?: Cents;
  term_length?: number | null;
  sub_type?: string | null;
  // Student loans: each disbursement's own balance and rate.
  disbursements?: { balance?: Cents; interest_rate_percentage?: number | null }[] | null;
};

export type MethodUpdate = {
  id: string;
  status?: string | null;
  source?: "direct" | "snapshot" | string | null;
  type: string;
  data_as_of?: string | null;
} & Partial<Record<string, MethodLiabilityData | unknown>>;

export type MethodAccount = {
  id: string;
  holder_id?: string | null;
  status?: string | null;
  type: string;
  liability?: { type?: string | null; name?: string | null; mask?: string | null } | null;
  // The newest Update, when expanded; its id otherwise.
  update?: MethodUpdate | string | null;
};

export interface MethodApi {
  liabilities(entityId: string): Promise<MethodAccount[]>;
}

// Method said no (its HTTP status) or the key isn't set. Never carries the key or the body.
export class MethodError extends Error {
  constructor(
    readonly status: number | null,
    readonly code: string,
  ) {
    super(`Method request failed: ${code}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "MethodError";
  }
}

const ID = /^ent_[A-Za-z0-9]{4,40}$/;

type HttpOptions = { env?: Record<string, string | undefined>; fetch?: typeof fetch };

export function methodHttp({
  env = process.env,
  fetch: send = fetch,
}: HttpOptions = {}): MethodApi {
  const base = env[METHOD.envEnv] === "production" ? METHOD.production : METHOD.development;
  return {
    async liabilities(entityId) {
      const key = env[METHOD.apiKeyEnv];
      if (!key) throw new MethodError(null, "NOT_CONFIGURED");
      if (!ID.test(entityId)) throw new MethodError(null, "BAD_ID");
      const out: MethodAccount[] = [];
      for (let page = 1; page <= METHOD.maxPages; page += 1) {
        const query = new URLSearchParams({
          holder_id: entityId,
          type: "liability",
          status: "active",
          "expand[]": "update",
          "sort[update]": "-data_as_of",
          page: String(page),
          page_limit: String(METHOD.pageLimit),
        });
        const response = await send(`${base}/accounts?${query}`, {
          headers: {
            authorization: `Bearer ${key}`,
            "method-version": METHOD.version,
            accept: "application/json",
          },
        });
        const body = (await response.json().catch(() => null)) as { data?: unknown } | null;
        if (!response.ok || !Array.isArray(body?.data)) {
          throw new MethodError(response.status, "REFUSED");
        }
        out.push(...(body.data as MethodAccount[]));
        if (body.data.length < METHOD.pageLimit) break;
      }
      return out;
    },
  };
}

import { PINWHEEL } from "@/config/connectors";

// Pinwheel's API, the part Jane reads (docs.pinwheelapi.com, read 2026-11-19: API Overview and Core Data
// Technical Implementation). For one connected payroll account:
// - GET /v1/accounts/{id}/employment: { data: { status, title, start_date, employer_name } }
// - GET /v1/accounts/{id}/paystubs?limit=: { data: [{ pay_date, pay_period_start, pay_period_end,
//   currency, gross_pay_amount, net_pay_amount, deductions: [{ name, category, amount, type }] }] },
//   amounts in cents.
// Only the fields Jane uses are typed here.

export type PinwheelEmployment = {
  status?: string | null;
  title?: string | null;
  start_date?: string | null;
  employer_name?: string | null;
};

export type PinwheelPaystub = {
  id?: string;
  pay_date?: string | null;
  pay_period_start?: string | null;
  pay_period_end?: string | null;
  currency?: string | null;
  gross_pay_amount?: number | null;
  net_pay_amount?: number | null;
  deductions?: { name?: string | null; category?: string | null; amount?: number | null }[] | null;
};

export interface PinwheelApi {
  employment(accountId: string): Promise<PinwheelEmployment>;
  paystubs(accountId: string): Promise<PinwheelPaystub[]>;
}

// Pinwheel said no (its HTTP status) or the secret isn't set. Never carries the secret or the body.
export class PinwheelError extends Error {
  constructor(
    readonly status: number | null,
    readonly code: string,
  ) {
    super(`Pinwheel request failed: ${code}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "PinwheelError";
  }
}

const ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type HttpOptions = { env?: Record<string, string | undefined>; fetch?: typeof fetch };

export function pinwheelHttp({
  env = process.env,
  fetch: send = fetch,
}: HttpOptions = {}): PinwheelApi {
  const mode = env[PINWHEEL.envEnv];
  const host =
    mode === "production" || mode === "development" ? PINWHEEL.hosts[mode] : PINWHEEL.hosts.sandbox;
  async function get(path: string): Promise<unknown> {
    const secret = env[PINWHEEL.apiSecretEnv];
    if (!secret) throw new PinwheelError(null, "NOT_CONFIGURED");
    const response = await send(`${host}${path}`, {
      headers: {
        "x-api-secret": secret,
        "Pinwheel-Version": PINWHEEL.version,
        accept: "application/json",
      },
    });
    const body = (await response.json().catch(() => null)) as { data?: unknown } | null;
    if (!response.ok || body?.data === undefined) {
      throw new PinwheelError(response.status, "REFUSED");
    }
    return body.data;
  }
  const checked = (accountId: string) => {
    if (!ID.test(accountId)) throw new PinwheelError(null, "BAD_ID");
    return accountId;
  };
  return {
    async employment(accountId) {
      return (await get(`/v1/accounts/${checked(accountId)}/employment`)) as PinwheelEmployment;
    },
    async paystubs(accountId) {
      const data = await get(
        `/v1/accounts/${checked(accountId)}/paystubs?limit=${PINWHEEL.paystubLimit}`,
      );
      if (!Array.isArray(data)) throw new PinwheelError(null, "SHAPE");
      return data as PinwheelPaystub[];
    },
  };
}

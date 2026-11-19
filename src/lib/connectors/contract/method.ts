import { METHOD } from "@/config/connectors";
import { methodHttp, type MethodAccount } from "../method/api";
import { methodReads } from "../method/normalize";
import { shapeMismatches, type ContractResult, type Spec } from "./shape";

// Method's contract in Development (docs.methodfi.com, read 2026-11-19: Getting Started for PFM, Create a
// BYO SMS / BYO KYC Verification, Testing Connect): the documented test entity (its own example person,
// a 555-01xx phone), verified the "bring your own" way, five simulated liabilities queued
// (POST /simulate/entities/{id}/connect), Connect run, then the adapter's own read and normalise.

const DEV = METHOD.development;

// What methodHttp and methodReads read of each account and its newest Update.
const ACCOUNT: Spec = {
  id: "string",
  type: "string",
  liability: { type: "string", name: "string?", mask: "string?" },
  update: { source: "string?", data_as_of: "string?", type: "string" },
};
const DATA: Record<string, Spec> = {
  credit_card: {
    balance: "number?",
    interest_rate_percentage_min: "number?",
    interest_rate_percentage_max: "number?",
    next_payment_due_date: "string?",
    next_payment_minimum_amount: "number?",
  },
  student_loans: { balance: "number?", disbursements: "array?", next_payment_due_date: "string?" },
};
const LOAN: Spec = {
  balance: "number?",
  interest_rate_percentage: "number?",
  next_payment_due_date: "string?",
  next_payment_minimum_amount: "number?",
};

export async function methodContract(
  env: Record<string, string | undefined>,
  send: typeof fetch,
): Promise<ContractResult> {
  const result: ContractResult = {
    connector: "method_liabilities (Development)",
    reachable: null,
    parsed: null,
    created: [],
    mismatches: [],
    note: "",
  };
  const key = env[METHOD.apiKeyEnv];
  if (!key) return { ...result, note: "METHOD_API_KEY missing" };
  const headers = {
    authorization: `Bearer ${key}`,
    "method-version": METHOD.version,
    "content-type": "application/json",
  };
  const post = (path: string, body: unknown) =>
    send(`${DEV}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const entity = await post("/entities", {
    type: "individual",
    individual: {
      first_name: "Sarah",
      last_name: "Chen",
      phone: "+14155550123",
      email: "sarah.chen@email.com",
      dob: "1992-07-15",
    },
    address: {
      line1: "123 Main St",
      line2: null,
      city: "San Francisco",
      state: "CA",
      zip: "94102",
    },
  });
  result.reachable = entity.status !== 401 && entity.status !== 403;
  const body = (await entity.json().catch(() => null)) as {
    id?: unknown;
    data?: { id?: unknown };
  } | null;
  // Method's envelope ({ data }) or the bare object its guide shows.
  const id = body?.data?.id ?? body?.id;
  if (!entity.ok || typeof id !== "string") {
    return { ...result, note: `creating the test entity answered HTTP ${entity.status}` };
  }
  result.created.push("entity (Method's documented example person)");
  const steps: [string, Response][] = [];
  steps.push([
    "phone (byo_sms)",
    await post(`/entities/${id}/verification_sessions`, {
      type: "phone",
      method: "byo_sms",
      byo_sms: { timestamp: new Date().toISOString() },
    }),
  ]);
  steps.push([
    "identity (byo_kyc)",
    await post(`/entities/${id}/verification_sessions`, {
      type: "identity",
      method: "byo_kyc",
      byo_kyc: {},
    }),
  ]);
  steps.push([
    "simulated liabilities",
    await post(`/simulate/entities/${id}/connect`, {
      behaviors: [
        "new_credit_card_account",
        "new_auto_loan_account",
        "new_mortgage_account",
        "new_student_loan_account",
        "new_personal_loan_account",
      ],
    }),
  ]);
  steps.push(["connect", await post(`/entities/${id}/connect`, {})]);
  // Method's error names (its type, sub_type and code), never its message text.
  const failed: string[] = [];
  for (const [name, r] of steps.filter(([, r]) => !r.ok)) {
    const body = (await r.json().catch(() => null)) as {
      error?: Record<string, unknown>;
      data?: { error?: Record<string, unknown> };
    } | null;
    const error = body?.error ?? body?.data?.error;
    const names = [error?.type, error?.sub_type, error?.code]
      .filter((v) => typeof v === "string" || typeof v === "number")
      .join("/");
    failed.push(`${name} HTTP ${r.status}${names ? ` (${names})` : ""}`);
  }
  if (failed.length) result.note = `steps refused: ${failed.join(", ")}`;
  // The adapter's own read and normalise, against what Development sent.
  let accounts: MethodAccount[];
  try {
    accounts = await methodHttp({ env: { ...env, [METHOD.envEnv]: "" }, fetch: send }).liabilities(
      id,
    );
  } catch (error) {
    return {
      ...result,
      parsed: false,
      note: `${result.note} read failed: ${(error as Error).name}`.trim(),
    };
  }
  for (const [i, account] of accounts.entries()) {
    result.mismatches.push(...shapeMismatches(account, ACCOUNT, `accounts[${i}]`));
    const update = account.update as Record<string, unknown> | null;
    const type = typeof update?.type === "string" ? update.type : "";
    if (type) {
      result.mismatches.push(
        ...shapeMismatches(update?.[type], DATA[type] ?? LOAN, `accounts[${i}].update.${type}`),
      );
    }
  }
  const reads = methodReads(accounts);
  result.parsed = true;
  const kinds = [...new Set(reads.map((r) => r.account.subtype))].sort().join(", ");
  result.note = `${result.note ? `${result.note}. ` : ""}${accounts.length} accounts read, ${reads.length} kept (${kinds || "none"})`;
  return result;
}

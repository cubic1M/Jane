import { PINWHEEL, POSTGRID } from "@/config/connectors";
import { pinwheelHttp } from "../pinwheel/api";
import { postGridTestHttp } from "../postgrid/api";
import { shapeMismatches, type ContractResult } from "./shape";

// The connectors whose read can't go further from here, said plainly, and PostGrid and Pinwheel when
// their test keys are set.

const empty = (connector: string, note: string): ContractResult => ({
  connector,
  reachable: null,
  parsed: null,
  created: [],
  mismatches: [],
  note,
});

export const chartContract = async (): Promise<ContractResult> =>
  empty(
    "Chart (IRS transcripts)",
    "not called: its read starts from a person's own IRS sign-in code",
  );

export const alpacaContract = async (): Promise<ContractResult> =>
  empty(
    "Alpaca (broker sandbox)",
    "not called: the adapter makes no read calls, only a buy and a cancel",
  );

export const signwellContract = async (): Promise<ContractResult> =>
  empty("SignWell", "not called: its only read is a document the person signed");

// PostGrid with a test key: a letter list read (GET /print-mail/v1/letters), each letter in the shape
// the adapter reads (id, status, live); nothing is made.
export async function postgridContract(
  env: Record<string, string | undefined>,
  send: typeof fetch,
): Promise<ContractResult> {
  const result = empty("sandbox_postgrid_letters (test mode)", "");
  const key = env[POSTGRID.testApiKeyEnv];
  if (!key) return { ...result, note: "POSTGRID_TEST_API_KEY missing" };
  if (!/^test_/.test(key)) return { ...result, note: "not a test key, not called" };
  // The adapter's client refuses a live key first; this read is its list call's shape.
  postGridTestHttp({ env, fetch: send });
  const r = await send(`${POSTGRID.baseUrl}${POSTGRID.lettersPath}?limit=5`, {
    headers: { "x-api-key": key },
  });
  result.reachable = r.status !== 401 && r.status !== 403;
  const body = (await r.json().catch(() => null)) as { data?: unknown[] } | null;
  result.parsed = r.ok && Array.isArray(body?.data);
  for (const [i, letter] of (body?.data ?? []).entries()) {
    result.mismatches.push(
      ...shapeMismatches(
        letter,
        { id: "string", status: "string", live: "boolean" },
        `letters[${i}]`,
      ),
    );
  }
  result.note = `${body?.data?.length ?? 0} test letters read`;
  return result;
}

// Pinwheel with a Sandbox secret: the adapter's employment read of an account that can't exist, to
// see the secret accepted (a 404, not a 401); reading a real one needs a person's payroll sign-in.
export async function pinwheelContract(
  env: Record<string, string | undefined>,
  send: typeof fetch,
): Promise<ContractResult> {
  const result = empty("pinwheel_payroll (Sandbox)", "");
  if (!env[PINWHEEL.apiSecretEnv]) return { ...result, note: "PINWHEEL_API_SECRET missing" };
  try {
    await pinwheelHttp({ env: { ...env, [PINWHEEL.envEnv]: "" }, fetch: send }).employment(
      "00000000-0000-4000-8000-000000000000",
    );
    result.reachable = true;
  } catch (error) {
    const status = (error as { status?: number | null }).status ?? null;
    result.reachable = status !== 401 && status !== 403;
  }
  result.note = "secret checked; pay stubs need a person's payroll sign-in";
  return result;
}

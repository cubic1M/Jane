import { randomUUID } from "node:crypto";
import { SNAPTRADE } from "@/config/connectors";
import { requestSignature, snaptradeHttp } from "../snaptrade/api";
import type { ContractResult } from "./shape";

// SnapTrade's contract (docs.snaptrade.com, read 2026-11-19): through the adapter's own client, a test
// SnapTrade user (registerUser, under an id made up for the run), its read-only Connection Portal link,
// and its accounts (none: no brokerage is connected without a person signing in, so positions can't be
// read here); then the user is deleted (DELETE /snapTrade/deleteUser). Run it with a test key: SnapTrade
// has one host for test and live keys.

export async function snaptradeContract(
  env: Record<string, string | undefined>,
  send: typeof fetch,
): Promise<ContractResult> {
  const result: ContractResult = {
    connector: "snaptrade_holdings",
    reachable: null,
    parsed: null,
    created: [],
    mismatches: [],
    note: "",
  };
  if (!env[SNAPTRADE.clientIdEnv] || !env[SNAPTRADE.consumerKeyEnv]) {
    return { ...result, note: "client id or consumer key missing" };
  }
  const api = snaptradeHttp({ env, fetch: send });
  let user: { userId: string; userSecret: string };
  try {
    user = await api.registerUser(randomUUID());
    result.reachable = true;
    result.created.push("SnapTrade user (deleted after)");
  } catch (error) {
    const status = (error as { status?: number | null }).status ?? null;
    result.reachable = status !== 401 && status !== 403;
    return {
      ...result,
      parsed: false,
      note: `registerUser failed: ${(error as { code?: string }).code ?? "error"}`,
    };
  }
  const parts: string[] = [];
  try {
    await api.connectLink(user);
    parts.push("portal link parsed");
  } catch (error) {
    result.mismatches.push(`login.redirectURI: ${(error as { code?: string }).code ?? "failed"}`);
  }
  try {
    const accounts = await api.accounts(user);
    parts.push(`${accounts.length} accounts (none until a person connects a broker)`);
  } catch (error) {
    result.mismatches.push(
      `accounts/all.results: ${(error as { code?: string }).code ?? "failed"}`,
    );
  }
  result.parsed = result.mismatches.length === 0;
  // Clean up: the test user goes.
  const query = new URLSearchParams({
    clientId: env[SNAPTRADE.clientIdEnv] ?? "",
    timestamp: String(Math.floor(Date.now() / 1000)),
    userId: user.userId,
  }).toString();
  const removed = await send(`${SNAPTRADE.baseUrl}/snapTrade/deleteUser?${query}`, {
    method: "DELETE",
    headers: {
      [SNAPTRADE.signatureHeader]: requestSignature(
        env[SNAPTRADE.consumerKeyEnv] ?? "",
        "/snapTrade/deleteUser",
        query,
        undefined,
      ),
    },
  }).catch(() => null);
  parts.push(`test user deleted ${removed?.ok ? "yes" : "no"}`);
  result.note = parts.join(", ");
  return result;
}

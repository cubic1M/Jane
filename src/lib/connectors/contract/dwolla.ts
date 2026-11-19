import { DWOLLA_SANDBOX } from "@/config/money-movement";
import { dwollaSandboxHttp } from "../../money-movement/dwolla/api";
import type { ContractResult } from "./shape";

// Dwolla's contract in its Sandbox (developers.dwolla.com, read 2026-11-19): the adapter's own token,
// then a $1.00 me-to-me transfer between the Sandbox account's own funding sources (its "Superhero
// Savings Bank" and its balance, made by Dwolla with every Sandbox account), read back through the
// adapter's status and cancelled through its cancel. Sandbox money only; nothing costs anything.

const MEDIA = DWOLLA_SANDBOX.mediaType;

export async function dwollaContract(
  env: Record<string, string | undefined>,
  send: typeof fetch,
): Promise<ContractResult> {
  const result: ContractResult = {
    connector: "Dwolla Sandbox partner",
    reachable: null,
    parsed: null,
    created: [],
    mismatches: [],
    note: "",
  };
  if (!env[DWOLLA_SANDBOX.keyEnv] || !env[DWOLLA_SANDBOX.secretEnv]) {
    return { ...result, note: "Sandbox key or secret missing" };
  }
  // The same token the adapter gets (POST /token), kept for the two calls it doesn't make itself.
  const tokenResponse = await send(`${DWOLLA_SANDBOX.base}/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${env[DWOLLA_SANDBOX.keyEnv]}:${env[DWOLLA_SANDBOX.secretEnv]}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  result.reachable = tokenResponse.ok;
  const token = (await tokenResponse.json().catch(() => null)) as {
    access_token?: unknown;
    expires_in?: unknown;
  } | null;
  if (typeof token?.access_token !== "string")
    result.mismatches.push("token.access_token: missing");
  if (typeof token?.expires_in !== "number")
    result.mismatches.push("token.expires_in: expected number");
  if (!tokenResponse.ok || typeof token?.access_token !== "string") {
    return { ...result, note: `token answered HTTP ${tokenResponse.status}` };
  }
  const get = async (url: string) => {
    const r = await send(url, {
      headers: { authorization: `Bearer ${token.access_token}`, accept: MEDIA },
    });
    return (await r.json().catch(() => null)) as Record<string, unknown> | null;
  };
  // The Sandbox account's own funding sources (GET / then the account's funding-sources link).
  const root = await get(`${DWOLLA_SANDBOX.base}/`);
  const accountHref =
    (root?._links as Record<string, { href?: string }> | undefined)?.account?.href ?? "";
  if (!accountHref.startsWith(`${DWOLLA_SANDBOX.base}/accounts/`)) {
    return { ...result, parsed: false, note: "no Sandbox account in the root links" };
  }
  const sources = ((
    (await get(`${accountHref}/funding-sources`))?._embedded as
      { "funding-sources"?: unknown[] } | undefined
  )?.["funding-sources"] ?? []) as {
    type?: string;
    removed?: boolean;
    _links?: { self?: { href?: string } };
  }[];
  const href = (type: string) =>
    sources.find((s) => s.type === type && !s.removed)?._links?.self?.href ?? null;
  const balance = href("balance");
  const bank = href("bank");
  if (!balance || !bank) {
    return {
      ...result,
      parsed: false,
      note: "the Sandbox account has no balance and bank to move between",
    };
  }
  // The adapter's own calls from here.
  const api = dwollaSandboxHttp({ env, fetch: send });
  try {
    const id = await api.createTransfer({
      sourceHref: balance,
      destinationHref: bank,
      amountCents: 100,
      correlationId: `jane-contract-${Date.now()}`,
      idempotencyKey: `jane-contract-${Date.now()}`,
    });
    result.created.push("$1.00 Sandbox transfer (cancelled)");
    const status = await api.transferStatus(id);
    if (status === null) result.mismatches.push("transfer.status: not one the adapter knows");
    const cancelled = await api.cancelTransfer(id);
    result.parsed = true;
    result.note = `transfer status recognised ${status ? "yes" : "no"}, cancel ${cancelled ? "accepted" : "refused"}`;
  } catch (error) {
    result.parsed = false;
    result.note = `the adapter's transfer calls failed: ${(error as { code?: string }).code ?? (error as Error).name}`;
  }
  return result;
}

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DWOLLA_SANDBOX, REAL_MONEY_MOVEMENT } from "@/config/money-movement";
import { DwollaError, dollars, dwollaSandboxHttp } from "./api";
import { dwollaSandboxPartner } from "./partner";

// Dwolla's Sandbox, against its own documented requests and responses (developers.dwolla.com, read
// 2026-11-19). No network: a fake fetch.

const ENV = {
  [DWOLLA_SANDBOX.keyEnv]: "test-dwolla-key",
  [DWOLLA_SANDBOX.secretEnv]: "test-dwolla-secret",
};
const SOURCE = `${DWOLLA_SANDBOX.base}/funding-sources/707177c3-bf15-4e7e-b37c-55c3898d9bf4`;
const DESTINATION = `${DWOLLA_SANDBOX.base}/funding-sources/b268f6b9-db3b-4ecc-83a2-8823a53ec8b7`;
const TRANSFER = "15c6bcce-46f7-e811-8112-e8dd3bececa8";

// Dwolla as its docs describe it: a token, then 201 with a Location for a new transfer.
function fakeDwolla(status = "pending", cancel = 200) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/token")) {
      return Response.json({
        access_token: "sandbox-token",
        token_type: "Bearer",
        expires_in: 3600,
      });
    }
    if (url.endsWith("/transfers") && init?.method === "POST") {
      return new Response(null, {
        status: 201,
        headers: { location: `${DWOLLA_SANDBOX.base}/transfers/${TRANSFER}` },
      });
    }
    if (init?.method === "POST") return new Response(null, { status: cancel });
    return Response.json({ id: TRANSFER, status });
  });
}

describe("Dwolla's Sandbox API", () => {
  it("gets a token with the key and secret, then sends a transfer as the reference shows", async () => {
    const send = fakeDwolla();
    const api = dwollaSandboxHttp({ env: ENV, fetch: send as never, now: () => 0 });
    const id = await api.createTransfer({
      sourceHref: SOURCE,
      destinationHref: DESTINATION,
      amountCents: 12_345,
      correlationId: "JANEQ-1",
      idempotencyKey: "JANEQ-1",
    });
    expect(id).toBe(TRANSFER);
    const [tokenUrl, tokenInit] = send.mock.calls[0] as [string, RequestInit];
    expect(tokenUrl).toBe("https://api-sandbox.dwolla.com/token");
    expect(tokenInit.body).toBe("grant_type=client_credentials");
    expect((tokenInit.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from("test-dwolla-key:test-dwolla-secret").toString("base64")}`,
    );
    const [url, init] = send.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("https://api-sandbox.dwolla.com/transfers");
    expect(init.headers).toMatchObject({
      authorization: "Bearer sandbox-token",
      accept: "application/vnd.dwolla.v1.hal+json",
      "idempotency-key": "JANEQ-1",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      _links: { source: { href: SOURCE }, destination: { href: DESTINATION } },
      amount: { value: "123.45", currency: "USD" },
      correlationId: "JANEQ-1",
    });
  });

  it("keeps the token until a minute before it expires", async () => {
    const send = fakeDwolla();
    let clock = 0;
    const api = dwollaSandboxHttp({ env: ENV, fetch: send as never, now: () => clock });
    await api.transferStatus(TRANSFER);
    clock = 3_500_000;
    await api.transferStatus(TRANSFER);
    clock = 3_550_000;
    await api.transferStatus(TRANSFER);
    expect(send.mock.calls.filter(([u]) => String(u).endsWith("/token"))).toHaveLength(2);
  });

  it("reads a transfer's status, and says when cancelling is too late", async () => {
    const processed = dwollaSandboxHttp({ env: ENV, fetch: fakeDwolla("processed", 400) as never });
    expect(await processed.transferStatus(TRANSFER)).toBe("processed");
    expect(await processed.cancelTransfer(TRANSFER)).toBe(false);
    const pending = dwollaSandboxHttp({ env: ENV, fetch: fakeDwolla("pending", 200) as never });
    expect(await pending.cancelTransfer(TRANSFER)).toBe(true);
  });

  it("writes cents as Dwolla's dollars", () => {
    expect(dollars(1)).toBe("0.01");
    expect(dollars(100)).toBe("1.00");
    expect(dollars(500_005)).toBe("5000.05");
  });

  it("calls nobody without the key, with another host's funding source, or a bad id", async () => {
    const none = vi.fn();
    const api = dwollaSandboxHttp({ env: ENV, fetch: none as never });
    const transfer = {
      sourceHref: SOURCE,
      destinationHref: DESTINATION,
      amountCents: 100,
      correlationId: "x",
      idempotencyKey: "x",
    };
    await expect(
      dwollaSandboxHttp({ env: {}, fetch: none as never }).createTransfer(transfer),
    ).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    await expect(
      api.createTransfer({ ...transfer, sourceHref: SOURCE.replace("api-sandbox", "api") }),
    ).rejects.toMatchObject({ code: "BAD_FUNDING_SOURCE" });
    await expect(api.createTransfer({ ...transfer, amountCents: 1.5 })).rejects.toMatchObject({
      code: "BAD_AMOUNT",
    });
    await expect(api.transferStatus("../accounts")).rejects.toMatchObject({ code: "BAD_ID" });
    expect(none).not.toHaveBeenCalled();
  });

  it("never carries the key or secret in an error", async () => {
    const refused = vi.fn(async () => Response.json({ error: "invalid_client" }, { status: 401 }));
    const error = await dwollaSandboxHttp({ env: ENV, fetch: refused as never })
      .transferStatus(TRANSFER)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DwollaError);
    expect(String((error as Error).message)).not.toMatch(/test-dwolla/);
  });

  it("only knows the Sandbox host: no production URL anywhere in Dwolla's code", () => {
    for (const file of ["api.ts", "partner.ts"]) {
      expect(readFileSync(join(__dirname, file), "utf8")).not.toMatch(/\/\/api\.dwolla\.com/);
    }
    expect(JSON.stringify(DWOLLA_SANDBOX)).not.toMatch(/\/\/api\.dwolla\.com/);
    expect(DWOLLA_SANDBOX.base).toBe("https://api-sandbox.dwolla.com");
    expect(REAL_MONEY_MOVEMENT).toBe(false);
  });
});

describe("Dwolla's Sandbox as Jane's money-movement partner", () => {
  const sources: Record<string, string> = { checking: SOURCE, savings: DESTINATION };
  const request = {
    fromAccountId: "checking",
    toAccountId: "savings",
    toName: "Savings",
    amountCents: 5_000,
    runOn: "2026-11-20",
    memo: "goal",
  };
  const partner = (
    api = {
      createTransfer: vi.fn(async () => TRANSFER),
      transferStatus: vi.fn(async () => "processed" as const),
      cancelTransfer: vi.fn(async () => true),
    },
  ) => ({
    api,
    movement: dwollaSandboxPartner({ fundingSource: (id) => sources[id] ?? null, api }),
  });

  it("queues in Jane on schedule and undoes there, never telling Dwolla", async () => {
    const { api, movement } = partner();
    const { partnerRef } = await movement.schedule(request);
    expect(partnerRef).toMatch(/^JANEQ-/);
    expect(await movement.cancel(partnerRef)).toBe(true);
    expect(await movement.settled({ runOn: request.runOn, partnerRef }, "2026-11-20")).toBe(false);
    expect(api.createTransfer).not.toHaveBeenCalled();
    expect(api.cancelTransfer).not.toHaveBeenCalled();
    expect(api.transferStatus).not.toHaveBeenCalled();
  });

  it("releases on its day under its queue ref, once, then reads Dwolla's status", async () => {
    const { api, movement } = partner();
    const { partnerRef } = await movement.schedule(request);
    const released = await movement.release!(partnerRef, request);
    expect(released.partnerRef).toBe(`dwolla:${TRANSFER}`);
    expect(api.createTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        amountCents: 5_000,
        correlationId: partnerRef,
        idempotencyKey: partnerRef,
      }),
    );
    expect(await movement.release!(released.partnerRef, request)).toEqual(released);
    expect(api.createTransfer).toHaveBeenCalledTimes(1);
    expect(
      await movement.settled(
        { runOn: request.runOn, partnerRef: released.partnerRef },
        "2026-11-20",
      ),
    ).toBe(true);
  });

  it("refuses a payment to someone else, or an account with no funding source", async () => {
    const { movement } = partner();
    await expect(movement.schedule({ ...request, toAccountId: null })).rejects.toThrow(
      /own linked accounts/,
    );
    await expect(movement.schedule({ ...request, fromAccountId: "card" })).rejects.toThrow(
      /own linked accounts/,
    );
  });
});

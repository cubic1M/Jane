import { describe, expect, it, vi } from "vitest";
import { NoPermission, withGrant } from "@/lib/permission/gate";
import { DWOLLA_SANDBOX, dwollaAdapter } from "./dwolla";
import { SPINWHEEL_SANDBOX, spinwheelAdapter } from "./spinwheel";
import { NotLinked, type LinkLookup } from "./types";

// The vendors, against mocks of their APIs built from their docs. These have NEVER been run against
// the real APIs: no key, no sign-up, no live call (src/lib/money-movement/adapters/*).

const permitted = <T>(act: () => Promise<T>) =>
  withGrant({ specialist: "money_movement", userId: "u" }, act);

const json = (body: unknown, status = 200, headers?: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers });

const bill = {
  fromAccountId: "acct-checking",
  toAccountId: null,
  toName: "Chase Sapphire",
  amountCents: 12_345,
  runOn: "2026-11-05",
  memo: "bill",
};
const links =
  (rows: Record<string, string>): LinkLookup =>
  (kind, ref) =>
    rows[`${kind}|${ref}`] ?? null;

describe("Spinwheel", () => {
  const linked = links({
    "user|self": "sw-user",
    "payer|acct-checking": "sw-payer",
    "credit_card|Chase Sapphire": "sw-card",
  });
  const respond = () =>
    vi.fn(async () => json({ data: { requestId: "req-1" } })) as unknown as typeof fetch;

  it("won't send outside the permission check", async () => {
    const fetcher = respond();
    const adapter = spinwheelAdapter({ apiKey: "k", fetcher });
    await expect(adapter.send(bill, { key: "x", link: linked })).rejects.toBeInstanceOf(
      NoPermission,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends the request its docs describe, to the sandbox, with the key as its reference", async () => {
    const fetcher = respond();
    const adapter = spinwheelAdapter({ apiKey: "secret", fetcher });
    const out = await permitted(() => adapter.send(bill, { key: "idem-1", link: linked }));
    expect(out).toEqual({ partnerRef: "req-1" });
    const [url, init] = vi.mocked(fetcher).mock.calls[0];
    expect(url).toBe(`${SPINWHEEL_SANDBOX}/v1/payments/requests`);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ authorization: "Bearer secret" });
    expect(JSON.parse(String(init?.body))).toEqual({
      userId: "sw-user",
      extRequestId: "idem-1",
      amount: 123.45,
      payerId: "sw-payer",
      requestType: "ONE_TIME",
      settlementSpeed: "STANDARD",
      useOfFunds: { allocation: [{ creditCardId: "sw-card", percentage: 100 }] },
    });
  });

  it("won't guess what isn't linked", async () => {
    const fetcher = respond();
    const adapter = spinwheelAdapter({ apiKey: "k", fetcher });
    await expect(
      permitted(() => adapter.send(bill, { key: "x", link: links({}) })),
    ).rejects.toBeInstanceOf(NotLinked);
    await expect(
      permitted(() =>
        adapter.send(bill, {
          key: "x",
          link: links({ "user|self": "u", "payer|acct-checking": "p" }),
        }),
      ),
    ).rejects.toBeInstanceOf(NotLinked);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("says so when it's refused, and when no id comes back", async () => {
    const adapter = (fetcher: typeof fetch) => spinwheelAdapter({ apiKey: "k", fetcher });
    await expect(
      permitted(() =>
        adapter(vi.fn(async () => json({}, 400)) as never).send(bill, { key: "x", link: linked }),
      ),
    ).rejects.toThrow("400");
    await expect(
      permitted(() =>
        adapter(vi.fn(async () => json({ data: {} })) as never).send(bill, {
          key: "x",
          link: linked,
        }),
      ),
    ).rejects.toThrow("no request id");
  });

  it.each([
    ["SCHEDULING", "pending"],
    ["PROCESSING", "pending"],
    ["SCHEDULED", "pending"],
    ["SCHEDULED_REVIEW_REQUIRED", "pending"],
    ["APPLIED", "settled"],
    ["FAILED", "failed"],
    ["CANCELLED", "failed"],
    ["RETURNED", "reversed"],
  ])("reads %s as %s", async (status, want) => {
    const fetcher = vi.fn(async () => json({ data: [{ status }] })) as unknown as typeof fetch;
    const adapter = spinwheelAdapter({ apiKey: "k", fetcher });
    expect(await adapter.status("req/1")).toBe(want);
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe(
      `${SPINWHEEL_SANDBOX}/v1/payments/transactions?requestId=req%2F1`,
    );
  });

  it("no transaction yet is pending", async () => {
    const fetcher = vi.fn(async () => json({ data: [] })) as unknown as typeof fetch;
    expect(await spinwheelAdapter({ apiKey: "k", fetcher }).status("r")).toBe("pending");
  });

  it("a cancel is whatever Spinwheel says: too late is false", async () => {
    const ok = vi.fn(async () => json({})) as unknown as typeof fetch;
    expect(await spinwheelAdapter({ apiKey: "k", fetcher: ok }).cancel("r")).toBe(true);
    expect(vi.mocked(ok).mock.calls[0][1]?.method).toBe("DELETE");
    const late = vi.fn(async () => json({}, 400)) as unknown as typeof fetch;
    expect(await spinwheelAdapter({ apiKey: "k", fetcher: late }).cancel("r")).toBe(false);
  });
});

describe("Dwolla", () => {
  const move = { ...bill, toAccountId: "acct-savings", toName: "Savings" };
  const linked = links({
    "funding_source|acct-checking": "fs-1",
    "funding_source|acct-savings": "fs-2",
  });
  // A mock of Dwolla: a token, then whatever the test says.
  const dwolla = (answers: Record<string, () => Response>) =>
    vi.fn(async (url: string | URL | Request) => {
      const address = String(url);
      if (address.endsWith("/token")) return json({ access_token: "tok" });
      const answer = answers[address.replace(DWOLLA_SANDBOX, "")];
      if (!answer) throw new Error(`Unexpected call: ${address}`);
      return answer();
    }) as unknown as typeof fetch;
  const adapter = (fetcher: typeof fetch) => dwollaAdapter({ key: "k", secret: "s", fetcher });

  it("won't send outside the permission check, or get a token first", async () => {
    const fetcher = dwolla({});
    await expect(adapter(fetcher).send(move, { key: "x", link: linked })).rejects.toBeInstanceOf(
      NoPermission,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("posts a transfer between the two funding sources, and reads the id from Location", async () => {
    const fetcher = dwolla({
      "/transfers": () => json({}, 201, { location: `${DWOLLA_SANDBOX}/transfers/transfer-1` }),
    });
    const out = await permitted(() => adapter(fetcher).send(move, { key: "idem", link: linked }));
    expect(out).toEqual({ partnerRef: "transfer-1" });
    const call = vi.mocked(fetcher).mock.calls.find(([u]) => String(u).endsWith("/transfers"))!;
    expect(call[1]?.headers).toMatchObject({
      authorization: "Bearer tok",
      "idempotency-key": "idem",
      accept: "application/vnd.dwolla.v1.hal+json",
    });
    expect(JSON.parse(String(call[1]?.body))).toEqual({
      _links: {
        source: { href: `${DWOLLA_SANDBOX}/funding-sources/fs-1` },
        destination: { href: `${DWOLLA_SANDBOX}/funding-sources/fs-2` },
      },
      amount: { currency: "USD", value: "123.45" },
    });
  });

  it("won't guess a funding source", async () => {
    const fetcher = dwolla({});
    await expect(
      permitted(() => adapter(fetcher).send(move, { key: "x", link: links({}) })),
    ).rejects.toBeInstanceOf(NotLinked);
  });

  it("counts a move as settled only once its second leg has landed", async () => {
    const leg2 = `${DWOLLA_SANDBOX}/transfers/leg-2`;
    const first =
      (status: string, link = true) =>
      () =>
        json({ status, _links: link ? { "funded-transfer": { href: leg2 } } : {} });
    const status = (firstLeg: () => Response, second?: string) =>
      adapter(
        dwolla({
          "/transfers/t": firstLeg,
          ...(second ? { "/transfers/leg-2": () => json({ status: second }) } : {}),
        }),
      ).status("t");
    expect(await status(first("pending", false))).toBe("pending");
    expect(await status(first("processed", false))).toBe("pending");
    expect(await status(first("processed"), "pending")).toBe("pending");
    expect(await status(first("processed"), "processed")).toBe("settled");
    expect(await status(first("processed"), "failed")).toBe("failed");
    expect(await status(first("failed", false))).toBe("failed");
  });

  it("a cancel is whatever Dwolla says", async () => {
    const fine = dwolla({ "/transfers/t": () => json({ status: "cancelled" }) });
    expect(await adapter(fine).cancel("t")).toBe(true);
    const late = dwolla({ "/transfers/t": () => json({}, 400) });
    expect(await adapter(late).cancel("t")).toBe(false);
  });
});

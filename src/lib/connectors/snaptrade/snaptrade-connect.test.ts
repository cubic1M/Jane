import { describe, expect, it, vi } from "vitest";
import { SNAPTRADE } from "@/config/connectors";
import { snaptradeHttp } from "./api";
import { snaptradeHoldings } from "./connector";

// SnapTrade's portal as the connect flow's partner step (../connect.ts): read only, coming back to
// Jane's own return address (loginSnapTradeUser's customRedirect).

const ENV = { [SNAPTRADE.clientIdEnv]: "TESTCLIENT", [SNAPTRADE.consumerKeyEnv]: "test-consumer" };
const USER = { userId: "0b8f8c2e-5c1a-4b7e-9a51-2f3d4c5b6a71", userSecret: "test-user-secret" };

describe("SnapTrade's partner step", () => {
  it("asks for a read connection that comes back to Jane", async () => {
    const send = vi.fn(async () => Response.json({ redirectURI: "https://app.snaptrade.com/x" }));
    await snaptradeHttp({ env: ENV, fetch: send as never }).connectLink(USER, {
      customRedirect:
        "https://jane.example/settings/connections/snaptrade_holdings/return?from=%2Fhome",
    });
    const init = (send.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toEqual({
      connectionType: "read",
      customRedirect:
        "https://jane.example/settings/connections/snaptrade_holdings/return?from=%2Fhome",
    });
  });

  it("refuses a way back that isn't a web address, calling nobody", async () => {
    const none = vi.fn();
    await expect(
      snaptradeHttp({ env: ENV, fetch: none as never }).connectLink(USER, {
        customRedirect: "javascript:x",
      }),
    ).rejects.toMatchObject({ code: "BAD_REDIRECT" });
    expect(none).not.toHaveBeenCalled();
  });

  it("is the real connector's step, and says where the data comes from", () => {
    expect(snaptradeHoldings.connect).toBeTypeOf("function");
    expect(snaptradeHoldings.from).toMatch(/through SnapTrade/);
  });
});

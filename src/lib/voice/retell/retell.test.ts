import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { RETELL } from "@/config/retell";
import { SIMULATED_NUMBER } from "../provider";
import { RetellError, callResultOf, retellHttp, retellSignatureValid, retellTestOn } from "./api";

// Retell's test calls, against Retell's own documented requests and webhooks (docs.retellai.com, read
// 2026-11-19). No network: a fake fetch.

const ENV = {
  [RETELL.switchEnv]: RETELL.switchValue,
  [RETELL.apiKeyEnv]: "test-retell-key",
  [RETELL.agentIdEnv]: "oBeDLoLOeuAbiuaMFXRtDOLriTJ5tSxD",
  [RETELL.fromNumberEnv]: "+14157774444",
};
const CALL = { token: "reply-token", actionId: "act_1", company: "Comcast", script: "Hi" };

describe("Retell's test calls", () => {
  it("is on only by its switch with every key", () => {
    expect(retellTestOn(ENV)).toBe(true);
    expect(retellTestOn({ ...ENV, [RETELL.switchEnv]: "" })).toBe(false);
    expect(retellTestOn({ ...ENV, [RETELL.fromNumberEnv]: "" })).toBe(false);
  });

  it("calls the simulated company's fiction number, as Create Phone Call describes", async () => {
    const send = vi.fn(async () => Response.json({ call_id: "Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6" }));
    expect(await retellHttp({ env: ENV, fetch: send as never }).callSimulatedCompany(CALL)).toBe(
      "Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6",
    );
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.retellai.com/v2/create-phone-call");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer test-retell-key");
    expect(JSON.parse(String(init.body))).toEqual({
      from_number: "+14157774444",
      to_number: "+12025550100",
      override_agent_id: "oBeDLoLOeuAbiuaMFXRtDOLriTJ5tSxD",
      idempotency_key: "jane-act_1",
      metadata: { token: "reply-token" },
      retell_llm_dynamic_variables: { company: "Comcast", script: "Hi" },
    });
  });

  it("only ever dials a fiction number, the same 555-0100 as the simulated provider's", () => {
    expect(RETELL.simulatedCompanyNumber).toMatch(RETELL.fictionNumber);
    expect(
      RETELL.simulatedCompanyNumber.endsWith(SIMULATED_NUMBER.replace(/\D/g, "").slice(1)),
    ).toBe(true);
    // 555-0100 to 555-0199 in a geographic area code is fiction; toll-free 555s and the rest are real.
    for (const fiction of ["+12025550100", "+14155550123", "+13105550199"]) {
      expect(fiction).toMatch(RETELL.fictionNumber);
    }
    for (const real of [
      "+12125551234",
      "+18005550100",
      "+18885550150",
      "+12025550200",
      "+1202555010",
    ]) {
      expect(real).not.toMatch(RETELL.fictionNumber);
    }
  });

  it("calls nobody when it's off, and never says the key in an error", async () => {
    const none = vi.fn();
    await expect(
      retellHttp({
        env: { ...ENV, [RETELL.switchEnv]: "" },
        fetch: none as never,
      }).callSimulatedCompany(CALL),
    ).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(none).not.toHaveBeenCalled();
    const refused = vi.fn(async () => Response.json({ error: "no" }, { status: 402 }));
    const error = await retellHttp({ env: ENV, fetch: refused as never })
      .callSimulatedCompany(CALL)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RetellError);
    expect(String((error as Error).message)).not.toContain("test-retell-key");
  });
});

describe("Retell's webhook signature", () => {
  const now = new Date("2026-11-19T15:00:00Z");
  const body = JSON.stringify({ event: "call_analyzed", call: { call_id: "x" } });
  const sign = (key: string, v: number, text = body) =>
    `v=${v},d=${createHmac("sha256", key)
      .update(text + v)
      .digest("hex")}`;
  const env = { [RETELL.apiKeyEnv]: "test-retell-key" };

  it("checks HMAC-SHA256 with the API key over the raw body and v, within five minutes", () => {
    const v = now.getTime() - 1000;
    expect(retellSignatureValid(body, sign("test-retell-key", v), { env, now })).toBe(true);
    expect(retellSignatureValid(body, sign("another", v), { env, now })).toBe(false);
    expect(retellSignatureValid(body + " ", sign("test-retell-key", v), { env, now })).toBe(false);
    const old = now.getTime() - 6 * 60_000;
    expect(retellSignatureValid(body, sign("test-retell-key", old), { env, now })).toBe(false);
    expect(retellSignatureValid(body, null, { env, now })).toBe(false);
    expect(retellSignatureValid(body, sign("test-retell-key", v), { env: {}, now })).toBe(false);
  });
});

describe("a finished Retell call as the agent's result", () => {
  it("reads the test agent's extraction in Jane's words", () => {
    expect(
      callResultOf({
        transcript: "Agent: hi",
        disconnection_reason: "agent_hangup",
        call_analysis: {
          custom_analysis_data: {
            outcome: "offer",
            offer: "$40 a month with a 12-month contract",
            offer_monthly_cents: 4_000,
            offer_contract_months: 12,
            offer_fee_cents: 0,
          },
        },
      }),
    ).toEqual({
      outcome: "offer",
      transcript: "Agent: hi",
      newMonthlyCents: null,
      offer: "$40 a month with a 12-month contract",
      offerTerms: { monthlyCents: 4_000, contractMonths: 12, feeCents: 0 },
    });
    expect(
      callResultOf({
        call_analysis: { custom_analysis_data: { outcome: "lowered", new_monthly_cents: 5_500 } },
      }),
    ).toMatchObject({ outcome: "lowered", newMonthlyCents: 5_500 });
  });

  it("says nobody answered when the dial failed, and needs a person for anything unclear", () => {
    expect(callResultOf({ disconnection_reason: "dial_no_answer" }).outcome).toBe("no_answer");
    expect(callResultOf({ disconnection_reason: "invalid_destination" }).outcome).toBe("no_answer");
    expect(
      callResultOf({ call_analysis: { custom_analysis_data: { outcome: "great" } } }).outcome,
    ).toBe("needs_person");
    expect(
      callResultOf({
        call_analysis: { custom_analysis_data: { outcome: "lowered", new_monthly_cents: -5 } },
      }).newMonthlyCents,
    ).toBeNull();
  });
});

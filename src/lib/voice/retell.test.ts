import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { NoPermission, withGrant } from "@/lib/permission/gate";
import {
  callResultOf,
  placeRetellCall,
  RETELL_TOLERANCE_MS,
  verifyRetellSignature,
} from "./retell";

// Retell, against a mock: never its real API.

const NOW = new Date("2026-11-02T12:00:00Z");
const sign = (body: string, at = NOW.getTime()) =>
  `v=${at},d=${createHmac("sha256", "key").update(`${body}${at}`).digest("hex")}`;

describe("the signature", () => {
  it("accepts the real one, and refuses changes, old ones and no key", () => {
    expect(verifyRetellSignature("{}", sign("{}"), "key", NOW)).toBe(true);
    expect(verifyRetellSignature("{ }", sign("{}"), "key", NOW)).toBe(false);
    expect(verifyRetellSignature("{}", sign("{}"), "other", NOW)).toBe(false);
    expect(verifyRetellSignature("{}", sign("{}"), "", NOW)).toBe(false);
    expect(verifyRetellSignature("{}", null, "key", NOW)).toBe(false);
    const old = NOW.getTime() - RETELL_TOLERANCE_MS - 1;
    expect(verifyRetellSignature("{}", sign("{}", old), "key", NOW)).toBe(false);
  });
});

describe("placing a call", () => {
  const call = { to: "+15550100", from: "+15550101", token: "tok", script: "Hello" };
  const fetcher = vi.fn(
    async () => new Response(JSON.stringify({ call_id: "call_1" }), { status: 201 }),
  ) as unknown as typeof fetch;

  it("can't happen outside the permission check", async () => {
    await expect(placeRetellCall(call, { apiKey: "k", fetcher })).rejects.toBeInstanceOf(
      NoPermission,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("posts the numbers and the script, with the token to find its way back", async () => {
    const out = await withGrant({ specialist: "phone_agent", userId: "u" }, () =>
      placeRetellCall(call, { apiKey: "k", fetcher }),
    );
    expect(out).toEqual({ callId: "call_1" });
    const [address, init] = vi.mocked(fetcher).mock.calls[0];
    expect(address).toBe("https://api.retellai.com/v2/create-phone-call");
    expect(JSON.parse(String(init?.body))).toEqual({
      from_number: "+15550101",
      to_number: "+15550100",
      retell_llm_dynamic_variables: { script: "Hello" },
      metadata: { token: "tok" },
    });
  });
});

describe("a call's result", () => {
  const analyzed = (call: object) => ({ event: "call_analyzed", call });

  it("waits for the analysis, and needs the call's token", () => {
    expect(callResultOf({ event: "call_ended", call: { metadata: { token: "t" } } })).toBeNull();
    expect(callResultOf(analyzed({}))).toBeNull();
  });

  it("reads the outcome and the new price", () => {
    expect(
      callResultOf(
        analyzed({
          metadata: { token: "t" },
          transcript: "They lowered it",
          call_analysis: { custom_analysis_data: { outcome: "lowered", new_monthly_cents: 6_000 } },
        }),
      ),
    ).toEqual({
      token: "t",
      result: {
        outcome: "lowered",
        transcript: "They lowered it",
        newMonthlyCents: 6_000,
        offer: null,
      },
    });
  });

  it("a call nobody answered is no answer, and anything unclear goes to a person", () => {
    const missed = callResultOf(
      analyzed({ metadata: { token: "t" }, disconnection_reason: "dial_no_answer" }),
    );
    expect(missed?.result.outcome).toBe("no_answer");
    const unclear = callResultOf(
      analyzed({
        metadata: { token: "t" },
        call_analysis: { custom_analysis_data: { outcome: "hm" } },
      }),
    );
    expect(unclear?.result.outcome).toBe("needs_person");
  });
});

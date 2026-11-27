import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PINWHEEL } from "@/config/connectors";
import { benefitOf } from "@/lib/insurance/benefits";
import { consentWords } from "../consent";
import { whyUnavailable } from "../registry";
import { signatureValid } from "../webhooks";
import { PinwheelError, pinwheelHttp } from "./api";
import { parsePinwheelEvent, pinwheelPayroll, sandboxPinwheelPayroll } from "./connector";
import { payFrequency, pinwheelPaystubs } from "./normalize";
import { PINWHEEL_DOCS_EMPLOYMENT, PINWHEEL_DOCS_PAYSTUBS, samplePaystubs } from "./sample";

// Pinwheel (read connectors, batch 2), against Pinwheel's own documented examples (docs.pinwheelapi.com,
// read 2026-11-19). No network: a fake fetch.

afterEach(() => vi.unstubAllEnvs());

const ACCOUNT = "03bbc20e-bc39-464a-b4dc-4b63ffb7213d";
const ENV = { [PINWHEEL.apiSecretEnv]: "test-pinwheel-secret" };

describe("Pinwheel's pay stubs as Jane's", () => {
  const [stub] = pinwheelPaystubs(PINWHEEL_DOCS_EMPLOYMENT, PINWHEEL_DOCS_PAYSTUBS);

  it("reads the documented stub: employer, date, gross, net and each deduction in cents", () => {
    expect(stub).toEqual({
      employer: "Walmart",
      payDate: "2020-12-31",
      payFrequency: "biweekly",
      grossCents: 480_769,
      netCents: 273_563,
      deductions: [
        { label: "Aetna PPO", amountCents: 7_012 },
        { label: "401(k) deferral", amountCents: 57_692 },
        { label: "Transit", amountCents: 2_000 },
      ],
      openEnrollment: null,
    });
    // What Jane's benefit patterns make of it: the medical plan is cover through work.
    expect(stub!.deductions.map((d) => benefitOf(d.label))).toEqual(["health", null, null]);
  });

  it("tells how often pay comes from the gap between pay dates, or the period with one stub", () => {
    const paid = (...dates: string[]) => dates.map((pay_date) => ({ pay_date }));
    expect(payFrequency(paid("2026-11-13", "2026-11-06"))).toBe("weekly");
    expect(payFrequency(paid("2026-11-13", "2026-10-30"))).toBe("biweekly");
    expect(payFrequency(paid("2026-11-15", "2026-10-31"))).toBe("semimonthly");
    expect(payFrequency(paid("2026-11-01", "2026-10-01"))).toBe("monthly");
    const period = (start: string, end: string) => [
      { pay_date: "2026-11-20", pay_period_start: start, pay_period_end: end },
    ];
    expect(payFrequency(period("2026-11-01", "2026-11-15"))).toBe("semimonthly");
    expect(payFrequency(period("2026-11-02", "2026-11-15"))).toBe("biweekly");
    expect(payFrequency(period("2026-11-09", "2026-11-15"))).toBe("weekly");
  });

  it("leaves out stubs in another currency, and everything without an employer", () => {
    expect(
      pinwheelPaystubs(PINWHEEL_DOCS_EMPLOYMENT, [
        { ...PINWHEEL_DOCS_PAYSTUBS[0]!, currency: "cad" },
      ]),
    ).toEqual([]);
    expect(pinwheelPaystubs({ employer_name: "" }, PINWHEEL_DOCS_PAYSTUBS)).toEqual([]);
  });

  it("dates the sample's stub five days before the person's day", () => {
    const [moved] = samplePaystubs("2026-11-19");
    expect(moved).toMatchObject({
      pay_date: "2026-11-14",
      pay_period_start: "2026-10-24",
      pay_period_end: "2026-11-07",
    });
  });

  // 11-27: the stub's period started on the 1st, which reads as half a month, so the sample's pay was
  // "twice a month" that day and "every two weeks" on others, and the sandbox test went red.
  it("reads every two weeks whatever the person's day, across month and year ends", () => {
    for (
      let at = Date.parse("2026-11-01T00:00:00Z");
      at < Date.parse("2027-12-31T00:00:00Z");
      at += 86_400_000
    ) {
      const today = new Date(at).toISOString().slice(0, 10);
      expect(payFrequency(samplePaystubs(today)), today).toBe("biweekly");
    }
    // The day the date moved on, and the day the shift is one more day back.
    expect(samplePaystubs("2026-11-27")[0]!.pay_period_start).toBe("2026-10-31");
  });
});

describe("Pinwheel's API, as its overview describes it", () => {
  it("reads employment and pay stubs from Sandbox with the secret and version headers", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: PINWHEEL_DOCS_EMPLOYMENT }))
      .mockResolvedValueOnce(Response.json({ meta: { count: 1 }, data: PINWHEEL_DOCS_PAYSTUBS }));
    const api = pinwheelHttp({ env: ENV, fetch: send as never });
    expect((await api.employment(ACCOUNT)).employer_name).toBe("Walmart");
    expect(await api.paystubs(ACCOUNT)).toHaveLength(1);
    const [url, init] = send.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://sandbox.getpinwheel.com/v1/accounts/${ACCOUNT}/employment`);
    expect(init.headers).toMatchObject({
      "x-api-secret": "test-pinwheel-secret",
      "Pinwheel-Version": "2025-07-08",
    });
    expect((send.mock.calls[1] as [string])[0]).toBe(
      `https://sandbox.getpinwheel.com/v1/accounts/${ACCOUNT}/paystubs?limit=3`,
    );
  });

  it("uses Sandbox unless PINWHEEL_ENV names development or production", async () => {
    const send = vi.fn(async () => Response.json({ data: {} }));
    for (const [mode, host] of [
      ["", "sandbox"],
      ["anything", "sandbox"],
      ["development", "development"],
      ["production", "api"],
    ]) {
      await pinwheelHttp({
        env: { ...ENV, [PINWHEEL.envEnv]: mode },
        fetch: send as never,
      }).employment(ACCOUNT);
      expect(String((send.mock.calls.at(-1) as unknown as [string])[0])).toMatch(
        new RegExp(`^https://${host}\\.getpinwheel\\.com/`),
      );
    }
  });

  it("calls nobody without the secret or with a bad id, and never says the secret", async () => {
    const none = vi.fn();
    await expect(
      pinwheelHttp({ env: {}, fetch: none as never }).paystubs(ACCOUNT),
    ).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    await expect(
      pinwheelHttp({ env: ENV, fetch: none as never }).paystubs("../x"),
    ).rejects.toMatchObject({ code: "BAD_ID" });
    expect(none).not.toHaveBeenCalled();
    const refused = vi.fn(async () => Response.json({ error: "no" }, { status: 401 }));
    const error = await pinwheelHttp({ env: ENV, fetch: refused as never })
      .paystubs(ACCOUNT)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PinwheelError);
    expect(String((error as Error).message)).not.toContain("test-pinwheel-secret");
  });
});

describe("Pinwheel's webhooks", () => {
  const now = new Date("2026-11-19T15:00:00Z");
  const t = String(Math.floor(now.getTime() / 1000));
  const body = JSON.stringify({
    event: "paystubs.added",
    event_id: "5a141122-4235-4fa1-bd76-0628573880b0",
    payload: { account_id: ACCOUNT, end_user_id: "u1", name: "paystubs", outcome: "success" },
  });
  const signing = pinwheelPayroll.webhook!.signing;
  const sign = (secret: string, at = t, text = body) =>
    new Headers({
      [PINWHEEL.signatureHeader]: `v2=${createHmac("sha256", secret).update(`v2:${at}:${text}`).digest("hex")}`,
      [PINWHEEL.timestampHeader]: at,
    });

  it("checks v2=<hex> over 'v2:<timestamp>:<body>' with the API secret, and its age", () => {
    const env = { [PINWHEEL.apiSecretEnv]: "test-pinwheel-secret" };
    expect(signatureValid(signing, body, sign("test-pinwheel-secret"), { env, now })).toBe(true);
    expect(signatureValid(signing, body, sign("another"), { env, now })).toBe(false);
    expect(signatureValid(signing, `${body} `, sign("test-pinwheel-secret"), { env, now })).toBe(
      false,
    );
    const old = String(Number(t) - 10 * 60);
    expect(signatureValid(signing, body, sign("test-pinwheel-secret", old), { env, now })).toBe(
      false,
    );
  });

  it("reads new pay stubs or employment as fresh data for that payroll account", () => {
    expect(parsePinwheelEvent(JSON.parse(body))).toEqual({
      kind: "link",
      eventId: "5a141122-4235-4fa1-bd76-0628573880b0",
      linkRef: ACCOUNT,
      change: "refreshed",
    });
    expect(
      parsePinwheelEvent({ event: "employment.added", payload: { account_id: ACCOUNT } })?.change,
    ).toBe("refreshed");
    expect(
      parsePinwheelEvent({
        event: "direct_deposit_switch.added",
        payload: { account_id: ACCOUNT },
      }),
    ).toBeNull();
    expect(
      parsePinwheelEvent({
        event: "paystubs.added",
        payload: { account_id: ACCOUNT, outcome: "error" },
      }),
    ).toBeNull();
  });
});

describe("who Pinwheel reaches", () => {
  const on = { CONNECTORS: "1" };

  it("is off for real people and trials, and the twin is for sample data only", () => {
    expect(whyUnavailable(pinwheelPayroll, { userId: "u", sampleData: false }, {})).toBe("off");
    expect(whyUnavailable(pinwheelPayroll, { userId: "u", sampleData: false }, on)).toBe(
      "switched_off",
    );
    expect(whyUnavailable(pinwheelPayroll, { userId: "trial_x", sampleData: false }, on)).toBe(
      "trial",
    );
    expect(
      whyUnavailable(sandboxPinwheelPayroll, { userId: "u", sampleData: true }, on),
    ).toBeNull();
    expect(whyUnavailable(sandboxPinwheelPayroll, { userId: "u", sampleData: false }, on)).toBe(
      "sandbox_for_samples",
    );
  });

  it("only reads, with the person's own words for what it sees", () => {
    for (const c of [pinwheelPayroll, sandboxPinwheelPayroll]) {
      expect(c.capabilities).toEqual(["read"]);
      expect(c.act).toBeUndefined();
      expect(c.movesMoney).toBe(false);
      expect(c.scopes).toEqual(["read_pay"]);
    }
    expect(consentWords(pinwheelPayroll, pinwheelPayroll.scopes)).not.toBeNull();
  });
});

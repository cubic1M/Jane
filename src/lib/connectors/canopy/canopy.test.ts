import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CANOPY } from "@/config/connectors";
import { signatureValid } from "../webhooks";
import { whyUnavailable } from "../registry";
import { CanopyError, canopyHttp } from "./api";
import { canopyConnect, parseCanopyEvent, sandboxCanopyConnect } from "./connector";
import { policiesFromPull } from "./normalize";
import { CANOPY_DOCS_PULL, samplePull } from "./sample";

// Canopy Connect (read connectors, 11-18), against Canopy's own documented example response
// (docs.usecanopy.com/openapi/documentation.json, read 2026-11-17). No network: a fake fetch.

afterEach(() => vi.unstubAllEnvs());

const PULL = "59ced597-b48f-49e3-9756-799e4c6f79a0";
const TEAM = "394661bc-6361-46f0-8b11-4106d6146cb4";
const ENV = {
  [CANOPY.clientIdEnv]: "test-client",
  [CANOPY.clientSecretEnv]: "test-secret-value",
  [CANOPY.teamIdEnv]: TEAM,
};

describe("a Canopy pull in Jane's insurance", () => {
  const [home, car, life] = policiesFromPull(CANOPY_DOCS_PULL);

  it("reads the home: premium, a 12-month term, its renewal, limits and deductible", () => {
    expect(home).toEqual({
      kind: "home",
      // The friendly name from the same carrier's life policy, not "statefarm".
      carrier: "State Farm",
      premiumCents: 175_349,
      premiumFrequency: "yearly",
      termMonths: 12,
      deductibleCents: 288_380,
      coverage: { dwelling: 28_838_000, personalProperty: 14_419_000, liability: 10_000_000 },
      renewalDate: "2023-12-13",
    });
  });

  it("reads the car: a 6-month term, its liability limits and what it covers", () => {
    expect(car).toMatchObject({
      kind: "auto",
      premiumCents: 50_781,
      premiumFrequency: "semiannual",
      termMonths: 6,
      deductibleCents: 50_000,
      renewalDate: "2023-06-13",
      coverage: {
        bodilyInjuryPerPerson: 10_000_000,
        bodilyInjuryPerAccident: 30_000_000,
        propertyDamage: 5_000_000,
        collision: true,
        comprehensive: true,
        uninsuredMotorist: true,
      },
    });
    expect(life.kind).toBe("life");
  });

  it("leaves out cover that's gone and commercial lines", () => {
    const gone = {
      ...CANOPY_DOCS_PULL,
      policies: [
        { ...CANOPY_DOCS_PULL.policies[0]!, status: "CANCELLED" },
        { ...CANOPY_DOCS_PULL.policies[1]!, policy_type: "COMMERCIAL_AUTO" },
        { ...CANOPY_DOCS_PULL.policies[1]!, status: "PENDING_CANCELLATION" },
      ],
    };
    expect(policiesFromPull(gone).map((p) => p.kind)).toEqual(["auto"]);
  });

  it("moves the sample's terms so the car renews in 21 days", () => {
    const sampleCar = policiesFromPull(samplePull("2026-11-18")).find((p) => p.kind === "auto")!;
    expect(sampleCar.renewalDate).toBe("2026-12-09");
    expect(sampleCar.termMonths).toBe(6);
  });
});

describe("Canopy's API, as its docs describe it", () => {
  it("asks for the team's pull with Basic auth", async () => {
    const send = vi.fn(async () => Response.json({ success: true, pull: CANOPY_DOCS_PULL }));
    const pull = await canopyHttp({ env: ENV, fetch: send as never }).getPull(PULL);
    expect(pull.policies).toHaveLength(3);
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://app.usecanopy.com/api/v1.0.0/teams/${TEAM}/pulls/${PULL}`);
    const auth = (init.headers as Record<string, string>).authorization!;
    expect(Buffer.from(auth.replace(/^Basic /, ""), "base64").toString()).toBe(
      "test-client:test-secret-value",
    );
  });

  it("says Canopy's error code, never the keys", async () => {
    const send = vi.fn(async () => Response.json({ error: "UNAUTHORIZED" }, { status: 401 }));
    const error = await canopyHttp({ env: ENV, fetch: send as never })
      .getPull(PULL)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CanopyError);
    expect(error).toMatchObject({ status: 401, code: "UNAUTHORIZED" });
    expect(String((error as Error).message)).not.toContain("test-secret-value");
  });

  it("calls nobody without keys, or with an id that isn't Canopy's", async () => {
    const send = vi.fn();
    await expect(canopyHttp({ env: {}, fetch: send as never }).getPull(PULL)).rejects.toMatchObject(
      { code: "NOT_CONFIGURED" },
    );
    await expect(
      canopyHttp({ env: ENV, fetch: send as never }).getPull("../teams/other"),
    ).rejects.toMatchObject({ code: "BAD_ID" });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("Canopy's webhooks", () => {
  const signing = canopyConnect.webhook!.signing;
  const now = new Date("2026-11-18T15:00:00Z");
  const t = Math.floor(now.getTime() / 1000);
  const body = JSON.stringify({ event_type: "COMPLETE", pull_id: PULL, team_id: TEAM });
  const mac = (secret: string) => createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");

  it("checks canopy-signature's t= and s= over the time and the body", () => {
    vi.stubEnv(CANOPY.webhookSecretEnv, "whook-test");
    const headers = (value: string) => new Headers({ [CANOPY.signatureHeader]: value });
    expect(signatureValid(signing, body, headers(`t=${t},s=${mac("whook-test")}`), { now })).toBe(
      true,
    );
    expect(signatureValid(signing, body, headers(`t=${t},s=${mac("another")}`), { now })).toBe(
      false,
    );
    // Stripe's field name isn't Canopy's.
    expect(signatureValid(signing, body, headers(`t=${t},v1=${mac("whook-test")}`), { now })).toBe(
      false,
    );
  });

  it("reads all data ready as fresh data, and a monitoring reconnect as a broken link", () => {
    expect(parseCanopyEvent(JSON.parse(body))).toEqual({
      kind: "link",
      eventId: "",
      linkRef: PULL,
      change: "refreshed",
    });
    expect(parseCanopyEvent({ event_type: "MONITORING_RECONNECT", pull_id: PULL })?.change).toBe(
      "disconnected",
    );
    expect(parseCanopyEvent({ event_type: "ERROR", pull_id: PULL })).toBeNull();
    expect(parseCanopyEvent({ event_type: "COMPLETE", pull_id: "not-a-pull" })).toBeNull();
  });
});

describe("who Canopy reaches", () => {
  const real = { userId: "user_real", sampleData: false };
  const sample = { userId: "user_sample", sampleData: true };
  const trial = { userId: "trial_abc", sampleData: false };
  const on = { CONNECTORS: "1" };

  it("reaches nobody with CONNECTORS off", () => {
    expect(whyUnavailable(canopyConnect, real, {})).toBe("off");
    expect(whyUnavailable(sandboxCanopyConnect, sample, {})).toBe("off");
  });

  it("is switched off for a real person, never for a trial person, and not for sample data", () => {
    expect(whyUnavailable(canopyConnect, real, on)).toBe("switched_off");
    expect(whyUnavailable(canopyConnect, trial, on)).toBe("trial");
    expect(whyUnavailable(canopyConnect, sample, on)).toBe("real_for_real");
  });

  it("gives sample data the sandbox twin, and only sample data", () => {
    expect(whyUnavailable(sandboxCanopyConnect, sample, on)).toBeNull();
    expect(whyUnavailable(sandboxCanopyConnect, real, on)).toBe("sandbox_for_samples");
  });

  it("only reads, never acts, and moves no money", () => {
    for (const c of [canopyConnect, sandboxCanopyConnect]) {
      expect(c.capabilities).toEqual(["read"]);
      expect(c.scopes).toEqual(["read_policies"]);
      expect(c.act).toBeUndefined();
      expect(c.movesMoney).toBe(false);
    }
  });
});

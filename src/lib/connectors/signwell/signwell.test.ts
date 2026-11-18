import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SIGNWELL } from "@/config/connectors";
import { signatureValid } from "../webhooks";
import { whyUnavailable } from "../registry";
import type { ActContext } from "../types";
import { SignwellError, signwellHttp } from "./api";
import {
  parseSignwellEvent,
  sandboxSignwellPermission,
  signwellConnector,
  signwellPermission,
} from "./connector";
import { letterHtml } from "./letter";

// SignWell (read connectors, 11-18), against SignWell's own reference (developers.signwell.com,
// Create Document, Event Data and Event Hash Verification, read 2026-11-17). No network.

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const DOC = "a692e1ce-9929-4541-adc7-61932bab39d3";
const DETAILS = {
  company: "Planet Fitness",
  acts: "cancel,account_info",
  until: "2027-11-18",
  signerName: "Alex Sample",
  signerEmail: "alex@example.com",
};
const context = (now = new Date("2026-11-18T15:00:00Z")): ActContext => ({
  userId: "user_1",
  actionId: "act_1",
  idempotencyKey: "jane_act_1",
  now,
  withSecret: async () => {
    throw new Error("no per-person secret");
  },
});

describe("the letter the person signs", () => {
  it("says who, which company, what Jane may do, until when, and what it may never do", () => {
    const html = letterHtml({
      signerName: "Alex Sample",
      company: "Planet Fitness",
      acts: ["cancel", "account_info"],
      until: "2027-11-18",
    });
    expect(html).toContain("I, Alex Sample, let Jane");
    expect(html).toContain("act for me with Planet Fitness");
    expect(html).toContain("cancel my account or subscription and ask for written confirmation");
    expect(html).toContain("This holds until November 18, 2027");
    expect(html).toContain("Jane may not move my money");
  });

  it("can't be written into with markup", () => {
    const html = letterHtml({
      signerName: "<script>x</script>",
      company: "A & B",
      acts: ["dispute"],
      until: "2027-01-01",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("A &#38; B");
  });

  it("is prefilled for the person to check, and refuses tasks outside the list", () => {
    const draft = signwellPermission.prefill!(DETAILS);
    expect(draft.amountCents).toBe(0);
    expect(draft.steps.map((s) => s.label)).toEqual([
      "Lets Jane",
      "With",
      "Until",
      "Signed by",
      "Sent to you to sign at",
      "Jane may not",
    ]);
    expect(() => signwellPermission.prefill!({ ...DETAILS, acts: "move_money" })).toThrow();
    expect(() => signwellPermission.prefill!({ ...DETAILS, acts: "" })).toThrow();
  });
});

describe("sending it through SignWell, as its reference describes", () => {
  const sent = vi.fn(async () => Response.json({ id: DOC, status: "Created" }));
  const api = signwellHttp({
    env: { [SIGNWELL.apiKeyEnv]: "test-api-key" },
    fetch: sent as never,
  });

  it("creates and sends one document with the letter, in test mode, for the person to sign", async () => {
    const result = await signwellConnector(api).act!(
      signwellPermission.prefill!(DETAILS),
      context(),
    );
    expect(result).toMatchObject({ externalRef: DOC, state: "pending" });
    expect(result.cancelUntil!.toISOString()).toBe("2026-12-02T15:00:00.000Z");
    const [url, init] = sent.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://www.signwell.com/api/v1/documents");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("test-api-key");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      test_mode: true,
      draft: false,
      with_signature_page: true,
      expires_in: 14,
      recipients: [{ id: "1", name: "Alex Sample", email: "alex@example.com" }],
      metadata: { jane_action: "act_1" },
    });
    expect(Buffer.from(body.files[0].file_base64, "base64").toString()).toContain(
      "act for me with Planet Fitness",
    );
  });

  it("withdraws it by deleting the document, and says SignWell's refusals without the key", async () => {
    const removed = vi.fn(async () => new Response(null, { status: 204 }));
    const api2 = signwellHttp({
      env: { [SIGNWELL.apiKeyEnv]: "test-api-key" },
      fetch: removed as never,
    });
    expect(await signwellConnector(api2).cancel!(DOC, context())).toBe(true);
    expect((removed.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe("DELETE");
    const refused = vi.fn(async () => Response.json({ error: "no" }, { status: 401 }));
    const error = await signwellHttp({
      env: { [SIGNWELL.apiKeyEnv]: "test-api-key" },
      fetch: refused as never,
    })
      .get(DOC)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SignwellError);
    expect(String((error as Error).message)).not.toContain("test-api-key");
  });

  it("sends binding letters only when SIGNWELL_ENV says production, and calls nobody without a key", async () => {
    const send = vi.fn(async () => Response.json({ id: DOC, status: "Created" }));
    await signwellConnector(
      signwellHttp({
        env: { [SIGNWELL.apiKeyEnv]: "k", [SIGNWELL.envEnv]: "production" },
        fetch: send as never,
      }),
    ).act!(signwellPermission.prefill!(DETAILS), context());
    expect(
      JSON.parse(String((send.mock.calls[0] as unknown as [string, RequestInit])[1].body))
        .test_mode,
    ).toBe(false);
    const none = vi.fn();
    await expect(signwellHttp({ env: {}, fetch: none as never }).get(DOC)).rejects.toMatchObject({
      code: "NOT_CONFIGURED",
    });
    expect(none).not.toHaveBeenCalled();
  });
});

describe("SignWell's webhooks", () => {
  const now = new Date("2026-11-18T15:00:00Z");
  const time = Math.floor(now.getTime() / 1000);
  const body = (type: string, key: string, at = time) =>
    JSON.stringify({
      event: {
        type,
        time: at,
        hash: createHmac("sha256", key).update(`${type}@${at}`).digest("hex"),
      },
      data: { object: { id: DOC, status: "Completed" } },
    });
  const signing = signwellPermission.webhook!.signing;

  it("checks the event hash with the webhook's id, and only near the event's time", () => {
    vi.stubEnv(SIGNWELL.webhookIdEnv, "webhook-id-test");
    const none = new Headers();
    expect(
      signatureValid(signing, body("document_completed", "webhook-id-test"), none, { now }),
    ).toBe(true);
    expect(signatureValid(signing, body("document_completed", "another"), none, { now })).toBe(
      false,
    );
    expect(
      signatureValid(signing, body("document_completed", "webhook-id-test", time - 3600), none, {
        now,
      }),
    ).toBe(false);
    expect(signatureValid(signing, "not json", none, { now })).toBe(false);
  });

  it("reads completed as signed, and declined, expired or cancelled as not", () => {
    vi.stubEnv(SIGNWELL.webhookIdEnv, "k");
    const read = (type: string) => parseSignwellEvent(JSON.parse(body(type, "k")));
    expect(read("document_completed")).toMatchObject({ externalRef: DOC, outcome: "done" });
    expect(read("document_declined")?.outcome).toBe("failed");
    expect(read("document_expired")?.outcome).toBe("failed");
    expect(read("document_canceled")?.outcome).toBe("failed");
    expect(read("document_viewed")?.outcome).toBe("info");
    expect(parseSignwellEvent({ event: { type: "document_completed" } })).toBeNull();
  });
});

describe("who SignWell reaches", () => {
  const real = { userId: "user_real", sampleData: false };
  const sample = { userId: "user_sample", sampleData: true };
  const trial = { userId: "trial_abc", sampleData: false };
  const on = { CONNECTORS: "1" };

  it("reaches nobody with CONNECTORS off, is switched off for real people and never for trials", () => {
    expect(whyUnavailable(signwellPermission, real, {})).toBe("off");
    expect(whyUnavailable(signwellPermission, real, on)).toBe("switched_off");
    expect(whyUnavailable(signwellPermission, trial, on)).toBe("trial");
    expect(whyUnavailable(sandboxSignwellPermission, sample, on)).toBeNull();
    expect(whyUnavailable(sandboxSignwellPermission, real, on)).toBe("sandbox_for_samples");
  });

  it("moves no money, and asks for the person's consent to send them a letter", () => {
    for (const c of [signwellPermission, sandboxSignwellPermission]) {
      expect(c.movesMoney).toBe(false);
      expect(c.scopes).toEqual(["sign_letters"]);
      expect(c.capabilities).toEqual(["prefill", "act"]);
    }
  });
});

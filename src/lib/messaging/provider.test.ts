import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TextSendError,
  messagingMode,
  sendSimulated,
  sendText,
  sendViaSendblue,
  statusFromProvider,
  webhookAuthorized,
} from "./provider";

const KEYS = {
  SENDBLUE_API_KEY: "key-id",
  SENDBLUE_API_SECRET: "key-secret",
  SENDBLUE_FROM_NUMBER: "+15125550100",
  SENDBLUE_WEBHOOK_SECRET: "hook-secret",
};
const stubKeys = (keys: Partial<typeof KEYS> = KEYS) => {
  for (const [name, value] of Object.entries(keys)) vi.stubEnv(name, value);
};

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("messagingMode (spec step 78)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is imessage only with all four keys", () => {
    vi.stubEnv("NODE_ENV", "production");
    stubKeys();
    expect(messagingMode()).toBe("imessage");
    vi.stubEnv("SENDBLUE_WEBHOOK_SECRET", "");
    expect(messagingMode()).toBe("off");
  });

  it("simulates outside production and never pretends in production", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(messagingMode()).toBe("simulated");
    vi.stubEnv("NODE_ENV", "production");
    expect(messagingMode()).toBe("off");
  });
});

describe("the Sendblue client", () => {
  beforeEach(() => stubKeys());
  afterEach(() => vi.unstubAllEnvs());

  it("posts to send-message with the key headers, the number, our line and the text", async () => {
    const fetcher = vi.fn(async () =>
      reply(202, { status: "QUEUED", message_handle: "5a17319e-handle" }),
    );
    const sent = await sendViaSendblue("+14155552671", "Hello from Jane", {
      fetcher: fetcher as unknown as typeof fetch,
    });
    expect(sent).toEqual({ providerId: "5a17319e-handle", status: "sent" });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.sendblue.com/api/send-message");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "sb-api-key-id": "key-id",
      "sb-api-secret-key": "key-secret",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      number: "+14155552671",
      from_number: "+15125550100",
      content: "Hello from Jane",
    });
  });

  it("fails (so the job retries) on an error status, a declined text or no handle", async () => {
    const cases = [
      reply(500, { status: "ERROR", error_code: 10001 }),
      reply(200, { status: "DECLINED", error_key: "opted_out", message_handle: "h" }),
      reply(200, { status: "QUEUED" }),
      new Response("not json", { status: 200 }),
    ];
    for (const response of cases) {
      const fetcher = vi.fn(async () => response);
      await expect(
        sendViaSendblue("+14155552671", "secret words", {
          fetcher: fetcher as unknown as typeof fetch,
        }),
      ).rejects.toBeInstanceOf(TextSendError);
    }
  });

  it("never puts the number or the text in an error", async () => {
    const fetcher = vi.fn(async () =>
      reply(400, { status: "ERROR", error_key: "invalid_number", error_code: 4000 }),
    );
    const error = await sendViaSendblue("+14155552671", "secret words", {
      fetcher: fetcher as unknown as typeof fetch,
    }).catch((e: Error) => e);
    expect(String(error)).toContain("invalid_number");
    expect(String(error)).not.toContain("4155552671");
    expect(String(error)).not.toContain("secret words");

    const offline = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    await expect(
      sendViaSendblue("+14155552671", "hi", { fetcher: offline as unknown as typeof fetch }),
    ).rejects.toThrow(/unreachable/);
  });

  it("goes through Sendblue from sendText when the keys are set", async () => {
    const fetcher = vi.fn(async () => reply(200, { status: "SENT", message_handle: "h1" }));
    expect(
      await sendText("+14155552671", "hi", { fetcher: fetcher as unknown as typeof fetch }),
    ).toEqual({ providerId: "h1", status: "sent" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("maps Sendblue's statuses to ours", () => {
    expect(statusFromProvider("DELIVERED")).toBe("delivered");
    expect(statusFromProvider("SENT")).toBe("sent");
    expect(statusFromProvider("QUEUED")).toBe("sent");
    expect(statusFromProvider("ERROR")).toBe("failed");
    expect(statusFromProvider("DECLINED")).toBe("failed");
    expect(statusFromProvider("RECEIVED")).toBeNull();
    expect(statusFromProvider(undefined)).toBeNull();
  });
});

describe("the simulated provider", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sends nothing, logs only the last two digits, and refuses in production", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const sent = await sendSimulated("+14155552671", "Jane's plan");
    expect(sent.providerId).toMatch(/^sim-/);
    expect(String(log.mock.calls[0][0])).not.toContain("4155552671");
    expect(String(log.mock.calls[0][0])).toContain("…71");
    vi.stubEnv("NODE_ENV", "production");
    await expect(sendSimulated("+14155552671", "x")).rejects.toBeInstanceOf(TextSendError);
    await expect(sendText("+14155552671", "x")).rejects.toBeInstanceOf(TextSendError);
  });
});

describe("webhookAuthorized", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts only Sendblue's sb-signing-secret header with our secret", () => {
    const headers = (value?: string) =>
      new Headers(value === undefined ? {} : { "sb-signing-secret": value });
    expect(webhookAuthorized(headers("hook-secret"))).toBe(false);
    vi.stubEnv("SENDBLUE_WEBHOOK_SECRET", "hook-secret");
    expect(webhookAuthorized(headers("hook-secret"))).toBe(true);
    expect(webhookAuthorized(headers("hook-secreT"))).toBe(false);
    expect(webhookAuthorized(headers("hook"))).toBe(false);
    expect(webhookAuthorized(headers())).toBe(false);
  });
});

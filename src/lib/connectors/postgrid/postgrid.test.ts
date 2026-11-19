import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POSTGRID } from "@/config/connectors";
import { allConnectors, whyUnavailable } from "../registry";
import { signatureValid } from "../webhooks";
import { PostGridError, postGridTestHttp, usAddress } from "./api";
import { letterHtml, mailingDay, sandboxPostgridLetters } from "./connector";

// PostGrid's letters in test mode, against its own documented requests and responses
// (postgrid.readme.io, read 2026-11-19). No network: a fake fetch.

afterEach(() => vi.unstubAllEnvs());

const ENV = { [POSTGRID.testApiKeyEnv]: "test_sk_fake" };
const LETTER = {
  to: { companyName: "LA Fitness", ...usAddress("P.O. Box 54170, Irvine, CA 92619")! },
  from: { firstName: "Alex", lastName: "Sample", ...POSTGRID.testSender },
  html: "<html><body><p>Hi</p></body></html>",
  description: "cancel_by_letter for action a1",
  janeKey: "key-1",
};
// Create Letter's documented 201, cut to what Jane reads.
const created = (live: boolean) =>
  Response.json({ id: "letter_123456", object: "letter", status: "ready", live }, { status: 201 });

describe("PostGrid's letters, test mode only", () => {
  it("makes a certified letter with the test key, as Create Letter describes", async () => {
    const send = vi.fn(async () => created(false));
    expect(await postGridTestHttp({ env: ENV, fetch: send as never }).createLetter(LETTER)).toBe(
      "letter_123456",
    );
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.postgrid.com/print-mail/v1/letters");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("test_sk_fake");
    expect(JSON.parse(String(init.body))).toEqual({
      to: {
        companyName: "LA Fitness",
        addressLine1: "P.O. Box 54170",
        city: "Irvine",
        provinceOrState: "CA",
        postalOrZip: "92619",
        countryCode: "US",
      },
      from: { firstName: "Alex", lastName: "Sample", ...POSTGRID.testSender },
      html: LETTER.html,
      mailingClass: "certified",
      description: LETTER.description,
      metadata: { janeKey: "key-1" },
    });
  });

  it("stops a letter that comes back live at once, and refuses a live key before any call", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(created(true))
      .mockResolvedValueOnce(Response.json({ id: "letter_123456", status: "cancelled" }));
    await expect(
      postGridTestHttp({ env: ENV, fetch: send as never }).createLetter(LETTER),
    ).rejects.toMatchObject({ code: "NOT_TEST_MODE" });
    expect((send.mock.calls[1] as unknown as [string, RequestInit])[1].method).toBe("DELETE");
    const none = vi.fn();
    await expect(
      postGridTestHttp({
        env: { [POSTGRID.testApiKeyEnv]: "live_sk_fake" },
        fetch: none as never,
      }).createLetter(LETTER),
    ).rejects.toMatchObject({ code: "NOT_TEST_MODE" });
    await expect(
      postGridTestHttp({ env: {}, fetch: none as never }).createLetter(LETTER),
    ).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(none).not.toHaveBeenCalled();
  });

  it("cancels while it's ready, and says so when it's too late", async () => {
    const ok = vi.fn(async () => Response.json({ id: "letter_123456", status: "cancelled" }));
    expect(await postGridTestHttp({ env: ENV, fetch: ok as never }).cancel("letter_123456")).toBe(
      true,
    );
    const late = vi.fn(async () => Response.json({ message: "not ready" }, { status: 400 }));
    expect(await postGridTestHttp({ env: ENV, fetch: late as never }).cancel("letter_123456")).toBe(
      false,
    );
    await expect(
      postGridTestHttp({ env: ENV, fetch: ok as never }).cancel("../contacts"),
    ).rejects.toBeInstanceOf(PostGridError);
  });

  it("reads a company's documented address, and refuses one it can't", () => {
    expect(usAddress("1 Main St, Suite 2, Springfield, IL 62701-1234")).toEqual({
      addressLine1: "1 Main St",
      addressLine2: "Suite 2",
      city: "Springfield",
      provinceOrState: "IL",
      postalOrZip: "62701-1234",
      countryCode: "US",
    });
    expect(usAddress("somewhere")).toBeNull();
    expect(usAddress("1 Main St, Toronto, ON M5V 2T6")).toBeNull();
  });

  it("writes the letter in plain words, escaped, saying who wrote it", () => {
    const html = letterHtml(
      { company: "LA <Fitness>", fromName: "Alex & Sample", purpose: "cancel" },
      mailingDay(new Date("2026-11-19T15:00:00Z")),
    );
    expect(html).toContain("November 19, 2026");
    expect(html).toContain("To LA &lt;Fitness&gt;:");
    expect(html).toContain("Please cancel my account, in the name of Alex &amp; Sample");
    expect(html).toContain(
      "Written by Jane, an AI assistant, for Alex &amp; Sample, with their yes.",
    );
    expect(html).not.toMatch(/save|\$/i);
  });
});

describe("PostGrid's webhook", () => {
  const now = new Date("2026-11-19T15:00:00Z");
  const raw = JSON.stringify({
    type: "letter.updated",
    data: { id: "letter_123456", status: "completed" },
  });
  const signing = sandboxPostgridLetters.webhook!.signing;
  const sign = (t: number, secret = "pg-secret") =>
    new Headers({
      "PostGrid-Signature": `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}`,
    });

  it("checks t in Unix milliseconds and the hex v1, as the docs' example shows", () => {
    const env = { [POSTGRID.webhookSecretEnv]: "pg-secret" };
    // The docs' own example header has a 13-digit t.
    expect(String(1718932335515)).toHaveLength(13);
    expect(signatureValid(signing, raw, sign(now.getTime() - 1000), { env, now })).toBe(true);
    expect(signatureValid(signing, raw, sign(now.getTime(), "guess"), { env, now })).toBe(false);
    expect(signatureValid(signing, raw, sign(now.getTime() - 10 * 60_000), { env, now })).toBe(
      false,
    );
    expect(signatureValid(signing, raw, sign(Math.floor(now.getTime() / 1000)), { env, now })).toBe(
      false,
    );
  });
});

describe("who PostGrid reaches", () => {
  it("is sandbox only: sample people, and no real PostGrid connector exists", () => {
    const on = { CONNECTORS: "1" };
    expect(sandboxPostgridLetters.sandbox).toBe(true);
    expect(
      whyUnavailable(sandboxPostgridLetters, { userId: "u", sampleData: true }, on),
    ).toBeNull();
    expect(whyUnavailable(sandboxPostgridLetters, { userId: "u", sampleData: false }, on)).toBe(
      "sandbox_for_samples",
    );
    expect(allConnectors().filter((c) => /postgrid/.test(c.id) && !c.sandbox)).toEqual([]);
    expect(sandboxPostgridLetters.movesMoney).toBe(false);
  });

  it("sends a trial person's letter nowhere: the plain sandbox answers, and PostGrid isn't called", async () => {
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    const context = {
      userId: "trial_abc",
      actionId: "a1",
      idempotencyKey: "k1",
      now: new Date("2026-11-19T15:00:00Z"),
      withSecret: async () => {
        throw new Error("no secret");
      },
    };
    const draft = {
      kind: "cancel_by_letter",
      amountCents: 0,
      summary: "",
      steps: [],
      details: {
        company: "LA Fitness",
        toAddress: "P.O. Box 54170, Irvine, CA 92619",
        fromName: "Alex Sample",
        purpose: "cancel",
      },
    };
    const result = await sandboxPostgridLetters.act!(draft as never, context as never);
    expect(result.externalRef).toMatch(/^sbx_letter/);
    expect(await sandboxPostgridLetters.cancel!(result.externalRef, context as never)).toBe(true);
    expect(send).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

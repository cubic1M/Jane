import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GMAIL_LIMITS, googleServer } from "@/config/gmail";
import { FakeGoogle } from "./__fixtures__/fake-google";
import { call, GoogleCallError, jsonOf } from "./google";

// The one way out to Google: which addresses it will call, what it does with a redirect, a slow
// server and a busy one, and how much of an answer it will read.

// A copy of the limits, so a test can change the wait between tries and the time a request gets.
vi.mock("@/config/gmail", async (original) => {
  const real = await original<typeof import("@/config/gmail")>();
  return { ...real, GMAIL_LIMITS: { ...real.GMAIL_LIMITS } };
});
const limits = GMAIL_LIMITS as { -readonly [K in keyof typeof GMAIL_LIMITS]: number };
// Short and unlike any other timer's, so the waits can be told apart.
const WAIT_MS = 7;

// The code a call failed with.
async function codeOf(work: Promise<unknown>): Promise<string> {
  const error: unknown = await work.then(
    () => null,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(GoogleCallError);
  return (error as GoogleCallError).code;
}

let fake: FakeGoogle;
beforeEach(async () => {
  limits.callRetryWaitMs = WAIT_MS;
  limits.callTimeoutMs = 10_000;
  fake = await new FakeGoogle().start();
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("GMAIL_API_URL", fake.origin);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fake.stop();
});

const profile = () => `${googleServer().api}/profile`;
const withToken = () => ({
  headers: { Authorization: `Bearer ${fake.issueTokensForTest().accessToken}` },
});
const statuses = () => fake.requests.map((request) => request.status);

describe("a request to Google", () => {
  it("goes to Google's address and brings back the answer", async () => {
    const response = await call(profile(), withToken());
    expect(response.status).toBe(200);
    expect(await jsonOf(response, 10_000)).toMatchObject({ emailAddress: fake.options.address });
  });

  it("brings back an answer whatever its status, for the caller to judge", async () => {
    expect((await call(profile())).status).toBe(401);
    expect((await call(`${googleServer().api}/nothing-here`, withToken())).status).toBe(404);
  });

  it("is sent once unless the caller asks for more", async () => {
    fake.answerWith("/profile", 503, { times: 5 });
    expect((await call(profile(), withToken())).status).toBe(503);
    expect(statuses()).toEqual([503]);
  });
});

describe("the rules every request is sent under", () => {
  const sent = () => {
    const stub = vi.fn(async (..._request: [string, RequestInit]) => new Response("{}"));
    vi.stubGlobal("fetch", stub);
    return stub;
  };
  afterEach(() => vi.unstubAllGlobals());

  it("are no redirect followed, no copy kept on the way, and a time limit", async () => {
    const stub = sent();
    await call(profile(), { method: "POST", body: "a=b", headers: { Accept: "application/json" } });
    const [address, init] = stub.mock.calls[0];
    expect(address).toBe(profile());
    expect(init).toMatchObject({
      method: "POST",
      body: "a=b",
      headers: { Accept: "application/json" },
      redirect: "error",
      cache: "no-store",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("can't be turned off by the caller", async () => {
    const stub = sent();
    const never = new AbortController().signal;
    await call(profile(), { redirect: "follow", cache: "force-cache", signal: never });
    const [, init] = stub.mock.calls[0];
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
    expect(init.signal).not.toBe(never);
  });
});

describe("an address that isn't Google's", () => {
  it.each([
    "https://evil.example/token",
    "https://oauth2.googleapis.com.evil.example/token",
    "https://gmail.googleapis.com@evil.example/gmail/v1/users/me/profile",
    "http://oauth2.googleapis.com/token",
    "https://storage.googleapis.com/a-bucket/keys.json",
    // The keys' host serves anyone's files too: only the keys' own path is called there.
    "https://www.googleapis.com/storage/v1/b/a-bucket/o/keys.json?alt=media",
    "http://127.0.0.1:9/token",
    "file:///etc/passwd",
    "not an address",
  ])("is refused before anything is sent: %s", async (address) => {
    vi.stubEnv("GMAIL_API_URL", "");
    const sent = vi.spyOn(globalThis, "fetch");
    expect(await codeOf(call(address, { method: "POST", body: "token=a-token" }))).toBe(
      "address_refused",
    );
    expect(await codeOf(call(address, {}, { retry: true }))).toBe("address_refused");
    expect(sent).not.toHaveBeenCalled();
  });

  it("is refused for Google's own sign-in page, which only a browser opens", async () => {
    vi.stubEnv("GMAIL_API_URL", "");
    const sent = vi.spyOn(globalThis, "fetch");
    expect(await codeOf(call(googleServer().authorize))).toBe("address_refused");
    expect(sent).not.toHaveBeenCalled();
  });

  it("is refused while a fake stands in, unless it is the fake's own", async () => {
    const other = await new FakeGoogle().start();
    try {
      const sent = vi.spyOn(globalThis, "fetch");
      for (const address of [
        `${other.origin}/token`,
        fake.origin.replace("http:", "https:"),
        "https://oauth2.googleapis.com/token",
      ]) {
        expect(await codeOf(call(address)), address).toBe("address_refused");
      }
      expect(sent).not.toHaveBeenCalled();
      expect(other.requests).toEqual([]);
    } finally {
      await other.stop();
    }
  });
});

describe("a redirect", () => {
  it("is never followed, so a token can't be carried off", async () => {
    const other = await new FakeGoogle().start();
    try {
      fake.options.redirectTo = `${other.origin}/steal`;
      expect(await codeOf(call(profile(), withToken()))).toBe("unreachable");
      expect(await codeOf(call(googleServer().token, { method: "POST", body: "code=a" }))).toBe(
        "unreachable",
      );
      expect(await codeOf(call(profile(), withToken(), { retry: true }))).toBe("unreachable");
      expect(other.requests).toEqual([]);
    } finally {
      await other.stop();
    }
  });
});

describe("a server that doesn't answer", () => {
  it("is given up on after the time one request gets", async () => {
    limits.callTimeoutMs = 150;
    const held = fake.hold("/profile");
    expect(await codeOf(call(profile(), withToken()))).toBe("timeout");
    held.release();
  });

  it("ends as a code of ours when it can't be reached at all", async () => {
    await fake.stop();
    expect(await codeOf(call(profile(), withToken()))).toBe("unreachable");
  });
});

describe("trying again", () => {
  const again = () => call(profile(), withToken(), { retry: true });

  it.each([429, 500, 502, 503])("follows a %i, and brings back the good answer", async (status) => {
    fake.answerWith("/profile", status);
    expect((await again()).status).toBe(200);
    expect(statuses()).toEqual([status, 200]);
  });

  it("follows a connection that was cut with no answer", async () => {
    fake.hangUp("/profile");
    expect((await again()).status).toBe(200);
    expect(statuses()).toEqual([0, 200]);
  });

  it("stops after the tries it is allowed, having waited longer each time", async () => {
    const timers = vi.spyOn(globalThis, "setTimeout");
    fake.answerWith("/profile", 503, { times: 10 });
    expect((await again()).status).toBe(503);
    expect(statuses()).toEqual(Array(1 + GMAIL_LIMITS.callRetries).fill(503));
    const waits = timers.mock.calls
      .map(([, ms]) => ms)
      .filter((ms) => typeof ms === "number" && ms % WAIT_MS === 0 && ms <= 10 * WAIT_MS);
    expect(waits).toEqual([WAIT_MS, 2 * WAIT_MS]);
  });

  it("ends as a code of ours when no try got an answer", async () => {
    fake.hangUp("/profile", 10);
    expect(await codeOf(again())).toBe("unreachable");
    expect(fake.requests).toHaveLength(1 + GMAIL_LIMITS.callRetries);
  });

  it.each([400, 401, 403, 404])("doesn't follow a %i, which won't change", async (status) => {
    fake.answerWith("/profile", status, { times: 5 });
    expect((await again()).status).toBe(status);
    expect(statuses()).toEqual([status]);
  });
});

describe("reading an answer", () => {
  const answer = (text: string) => new Response(text);
  // A body that arrives in pieces and then goes wrong.
  const cutOff = (error: Error) =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"emailAddress":'));
          controller.error(error);
        },
      }),
    );

  it("gives the JSON object it holds", async () => {
    expect(await jsonOf(answer('{"historyId":"12","n":{"a":[1]}}'), 1_000)).toEqual({
      historyId: "12",
      n: { a: [1] },
    });
  });

  it("takes an answer up to the limit and refuses one past it", async () => {
    const body = JSON.stringify({ text: "x".repeat(500) });
    expect(await jsonOf(answer(body), body.length)).toEqual({ text: "x".repeat(500) });
    expect(await codeOf(jsonOf(answer(body), body.length - 1))).toBe("too_large");
  });

  it("stops reading at the limit, however much more there is", async () => {
    let sent = 0;
    let cancelled = false;
    const endless = new Response(
      new ReadableStream({
        pull(controller) {
          sent += 1;
          controller.enqueue(new Uint8Array(1_000));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
    expect(await codeOf(jsonOf(endless, 10_000))).toBe("too_large");
    expect(cancelled).toBe(true);
    expect(sent).toBeLessThan(20);
  });

  it.each(["", "<html>Bad Gateway</html>", "{", "[1,2]", "null", "5", '"text"'])(
    "refuses what isn't a JSON object: %j",
    async (text) => {
      expect(await codeOf(jsonOf(answer(text), 1_000))).toBe("not_json");
    },
  );

  // An answer that stopped half way mustn't read as an empty one: the caller would take a message
  // that Gmail failed to send for a message with nothing in it.
  it("fails, rather than give an empty answer, when the answer stops part way", async () => {
    expect(await codeOf(jsonOf(cutOff(new Error("socket hang up")), 1_000))).toBe("unreachable");
    const late = Object.assign(new Error("too slow"), { name: "TimeoutError" });
    expect(await codeOf(jsonOf(cutOff(late), 1_000))).toBe("timeout");
  });

  it("says nothing of what the answer held when it refuses it", async () => {
    const marker = `marker-${Math.random()}`;
    for (const work of [
      jsonOf(answer(`{"access_token":"${marker}"`), 1_000),
      jsonOf(answer(JSON.stringify({ access_token: marker })), 5),
      jsonOf(answer(JSON.stringify([marker])), 1_000),
    ]) {
      const error: unknown = await work.catch((thrown: unknown) => thrown);
      expect(String(error)).toMatch(/^GoogleCallError: Google call failed: [a-z_]+$/);
      expect(JSON.stringify(error)).not.toContain(marker);
    }
  });
});

// Rule 7 of the design: every outside call goes to an allow-listed Google address, without
// redirects, with a timeout and a size cap. That holds because only call() sends anything.
describe("no other code of the feature calls out", () => {
  const files = (dir: string): string[] =>
    !existsSync(dir)
      ? []
      : readdirSync(dir).flatMap((name) => {
          const path = join(dir, name);
          if (statSync(path).isDirectory()) return name === "__fixtures__" ? [] : files(path);
          return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
        });
  const feature = [
    "src/lib/gmail",
    "src/app/api/gmail",
    "src/app/api/cron/gmail",
    "src/app/settings/mailboxes",
  ].flatMap((dir) => files(dir));
  const SENDS = /\bfetch\(|from "(?:node:)?https?"|from "undici"|XMLHttpRequest|\bWebSocket\b/;

  it("finds the feature's files, and knows a request when it sees one", () => {
    expect(feature).toContain("src/lib/gmail/google.ts");
    expect(feature).toContain("src/lib/gmail/api.ts");
    expect(feature.some((path) => /__fixtures__|\.test\./.test(path))).toBe(false);
    expect(SENDS.test("const response = await fetch(url, init);")).toBe(true);
    expect(SENDS.test('import { request } from "node:https";')).toBe(true);
    expect(SENDS.test("// The keys are fetched at most once a minute.")).toBe(false);
  });

  it("only google.ts sends a request", () => {
    const senders = feature.filter((path) => SENDS.test(readFileSync(path, "utf8")));
    expect(senders).toEqual(["src/lib/gmail/google.ts"]);
  });

  it("the fake Google is for tests: no app code imports it", () => {
    const app = files("src").filter((path) => !path.startsWith("src/generated"));
    const importers = app.filter((path) =>
      /from "[^"]*fake-google"/.test(readFileSync(path, "utf8")),
    );
    expect(importers).toEqual([]);
  });
});

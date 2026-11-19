import { constants, createHmac, generateKeyPairSync, sign, verify } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GMAIL_LIMITS, googleServer } from "@/config/gmail";
import { FakeGoogle } from "./__fixtures__/fake-google";
import { call } from "./google";
import { clearGmailWebhookKeysForTests, verifyGmailWebhook } from "./webhook-verify";

// Whether a notice is Google's: the token's shape, its algorithm, what it says of itself, the key,
// the signature and the times, in that order, with Google's keys served by the fake.

const NOW = new Date("2026-11-18T12:00:00Z");
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const SKEW = GMAIL_LIMITS.clockSkewSeconds;
const REFETCH_MS = GMAIL_LIMITS.keysRefetchSeconds * SECOND;
const KEPT_MS = GMAIL_LIMITS.keysHours * HOUR;

// Someone else's keys: an RSA pair Google never published, and a pair of another kind.
const attacker = generateKeyPairSync("rsa", { modulusLength: 2048 });
const elliptic = generateKeyPairSync("ec", { namedCurve: "P-256" });

const later = (ms: number) => new Date(NOW.getTime() + ms);
const seconds = (at: Date) => Math.floor(at.getTime() / SECOND);
const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

let fake: FakeGoogle;
beforeEach(async () => {
  clearGmailWebhookKeysForTests();
  fake = await new FakeGoogle().start();
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("GMAIL_API_URL", fake.origin);
  vi.stubEnv("GMAIL_PUSH_AUDIENCE", fake.pushAudience);
  vi.stubEnv("GMAIL_PUSH_SERVICE_ACCOUNT", fake.pushServiceAccount);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await fake.stop();
});

// A token as Google sends one at `at`, unless told otherwise.
const tokenAt = (at: Date, over: Parameters<FakeGoogle["noticeToken"]>[0] = {}) =>
  fake.noticeToken({ now: at, ...over });
const token = (over: Parameters<FakeGoogle["noticeToken"]>[0] = {}) => tokenAt(NOW, over);
const check = (sent: string, now = NOW) => verifyGmailWebhook(`Bearer ${sent}`, { now });
// How often Google's keys were asked for.
const fetches = () => fake.requests.filter((request) => request.path === "/oauth2/v3/certs").length;

describe("a notice from Google", () => {
  it("is taken: signed by Google's key, for our audience and our service account", async () => {
    expect(await check(token())).toBe(true);
  });

  it.each(["https://accounts.google.com", "accounts.google.com"])(
    "is taken with Google calling itself %s",
    async (iss) => {
      expect(await check(token({ claims: { iss } }))).toBe(true);
    },
  );

  // Google's own documents: a token sent with a notice may be up to an hour old.
  it("is taken when its token was made 59 minutes ago", async () => {
    const made = later(-59 * MINUTE);
    expect(await check(tokenAt(made))).toBe(true);
  });

  it("is taken however long ago its token was made, while the token hasn't ended", async () => {
    const claims = { iat: seconds(later(-30 * 24 * HOUR)), exp: seconds(later(5 * MINUTE)) };
    expect(await check(token({ claims }))).toBe(true);
  });

  it("is taken again when the same token comes twice: it says who calls, not what was sent", async () => {
    const sent = token();
    expect(await check(sent)).toBe(true);
    expect(await check(sent, later(30 * MINUTE))).toBe(true);
  });

  it("is taken with the settings pasted with spaces around them", async () => {
    vi.stubEnv("GMAIL_PUSH_AUDIENCE", `  ${fake.pushAudience}\n`);
    vi.stubEnv("GMAIL_PUSH_SERVICE_ACCOUNT", ` ${fake.pushServiceAccount} `);
    expect(await check(token())).toBe(true);
  });
});

describe("the Authorization header", () => {
  it("must be there", async () => {
    expect(await verifyGmailWebhook(null, { now: NOW })).toBe(false);
    expect(await verifyGmailWebhook("", { now: NOW })).toBe(false);
    expect(fetches()).toBe(0);
  });

  it("must be a Bearer token of three parts", async () => {
    const good = token();
    const [head, body, signature] = good.split(".");
    for (const header of [
      "Bearer",
      "Bearer ",
      good,
      `Basic ${good}`,
      `Token ${good}`,
      `Bearer ${head}.${body}`,
      `Bearer ${head}.${body}.${signature}.${signature}`,
      `Bearer ${good} ${good}`,
      `Bearer ${good} extra`,
      `Bearer ${good}, Bearer ${good}`,
      "Bearer not-a-token",
      "Bearer !!!.???.***",
      "Bearer ..",
      `Bearer ${part(5)}.${body}.${signature}`,
      `Bearer ${part([1])}.${body}.${signature}`,
      `Bearer ${head}.${part("claims")}.${signature}`,
      `Bearer ${head}.${part(null)}.${signature}`,
    ]) {
      expect(await verifyGmailWebhook(header, { now: NOW }), header.slice(0, 30)).toBe(false);
    }
    expect(fetches()).toBe(0);
  });

  it("may write the word Bearer in any capitals, as the standard allows", async () => {
    expect(await verifyGmailWebhook(`bearer ${token()}`, { now: NOW })).toBe(true);
    expect(await verifyGmailWebhook(` BEARER ${token()} `, { now: NOW })).toBe(true);
  });
});

describe("the algorithm", () => {
  // Each is signed by Google's own key with RS256, so only the name in the header is wrong.
  it.each(["none", "None", "HS256", "RS384", "RS512", "PS256", "ES256", "rs256", "RS256 ", ""])(
    "must be named RS256 exactly: not %j, even over a good signature",
    async (alg) => {
      expect(await check(token({ header: { alg } }))).toBe(false);
      expect(fetches()).toBe(0);
    },
  );

  it("must be named, and as text", async () => {
    expect(await check(token({ header: { alg: undefined } }))).toBe(false);
    expect(await check(token({ header: { alg: ["RS256"] } }))).toBe(false);
    expect(await check(token({ header: { alg: null } }))).toBe(false);
    expect(fetches()).toBe(0);
  });

  it("refuses a token that says none and brings no signature", async () => {
    const [, body] = token().split(".");
    const head = part({ alg: "none", kid: fake.key.kid, typ: "JWT" });
    expect(await check(`${head}.${body}.`)).toBe(false);
    // The same with the header left saying RS256.
    expect(await check(`${token().split(".")[0]}.${body}.`)).toBe(false);
  });

  // The classic confusion: the public key, which anyone can fetch, used as an HMAC secret.
  it("refuses an HMAC made with Google's public key, whatever the header says", async () => {
    const [, body] = token().split(".");
    const publicKeys = [
      fake.key.publicKey.export({ type: "spki", format: "pem" }),
      fake.key.publicKey.export({ type: "pkcs1", format: "pem" }),
      fake.key.publicKey.export({ type: "spki", format: "der" }),
    ];
    for (const secret of publicKeys) {
      for (const alg of ["HS256", "RS256"]) {
        const head = part({ alg, kid: fake.key.kid, typ: "JWT" });
        const mac = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
        expect(await check(`${head}.${body}.${mac}`), alg).toBe(false);
      }
    }
  });

  it("refuses a signature of another RSA scheme under an RS256 header", async () => {
    const [head, body] = token().split(".");
    const data = Buffer.from(`${head}.${body}`);
    const pss = sign("sha256", data, {
      key: fake.key.privateKey,
      padding: constants.RSA_PKCS1_PSS_PADDING,
    });
    const sha384 = sign("RSA-SHA384", data, fake.key.privateKey);
    expect(await check(`${head}.${body}.${pss.toString("base64url")}`)).toBe(false);
    expect(await check(`${head}.${body}.${sha384.toString("base64url")}`)).toBe(false);
  });

  it("must come with a key id, as text", async () => {
    expect(await check(token({ header: { kid: undefined } }))).toBe(false);
    expect(await check(token({ header: { kid: 5 } }))).toBe(false);
    expect(await check(token({ header: { kid: [fake.key.kid] } }))).toBe(false);
    expect(fetches()).toBe(0);
  });
});

// Each token here is signed by Google's own key, so only what it says is wrong. None costs a
// fetch: a token made for someone else's subscription is turned away before any key is asked for.
describe("what the token says of itself", () => {
  it.each([
    ["issued by someone else", { iss: "https://accounts.evil.example" }],
    [
      "issued by a name that only starts like Google's",
      { iss: "https://accounts.google.com.evil.example" },
    ],
    ["issued by Google's name with something after it", { iss: "https://accounts.google.com/" }],
    ["issued by Google's name in capitals", { iss: "HTTPS://ACCOUNTS.GOOGLE.COM" }],
    ["issued by a list that holds Google's name", { iss: ["https://accounts.google.com"] }],
    ["with no issuer", { iss: undefined }],
    ["made for another audience", { aud: "https://other.example/api/gmail/webhook" }],
    ["made for our audience in other capitals", { aud: "https://JANE.example/api/gmail/webhook" }],
    [
      "made for our audience with something after it",
      { aud: "https://jane.example/api/gmail/webhook/" },
    ],
    [
      "made for a list that holds our audience",
      { aud: ["https://jane.example/api/gmail/webhook"] },
    ],
    ["with no audience", { aud: undefined }],
    ["from another service account", { email: "attacker@other-project.iam.gserviceaccount.com" }],
    [
      "from our service account in capitals",
      { email: "GMAIL-NOTICES@fake-project.iam.gserviceaccount.com" },
    ],
    [
      "from a list that holds our service account",
      { email: ["gmail-notices@fake-project.iam.gserviceaccount.com"] },
    ],
    ["with no service account", { email: undefined }],
    ["with an address Google hasn't checked", { email_verified: false }],
    ["with the check written as text", { email_verified: "true" }],
    ["with the check written as a number", { email_verified: 1 }],
    ["with nothing said of the check", { email_verified: undefined }],
  ])("is refused, with no key fetched, when %s", async (_what, claims) => {
    expect(await check(token({ claims }))).toBe(false);
    expect(fetches()).toBe(0);
  });

  it("is what the fake's own settings say, so the rows above are near misses", () => {
    expect(fake.pushAudience).toBe("https://jane.example/api/gmail/webhook");
    expect(fake.pushServiceAccount).toBe("gmail-notices@fake-project.iam.gserviceaccount.com");
  });

  // What an attacker's own Google Cloud project can make: a real Google token for our address, but
  // only from a service account of their own.
  it("is refused from another project's service account, though Google signed it", async () => {
    const theirs = token({ claims: { email: "push@attacker-project.iam.gserviceaccount.com" } });
    expect(await check(theirs)).toBe(false);
    expect(await check(token())).toBe(true);
  });
});

describe("the signature", () => {
  it("must be made by Google's key, not by another under Google's key id", async () => {
    expect(await check(token({ key: attacker.privateKey }))).toBe(false);
    expect(fetches()).toBe(1);
  });

  it("covers the claims and the header: neither can be changed after signing", async () => {
    const [head, body, signature] = token().split(".");
    const claims = JSON.parse(Buffer.from(body, "base64url").toString()) as Record<string, unknown>;
    const longer = part({ ...claims, exp: Number(claims.exp) + 3600 });
    expect(await check(`${head}.${longer}.${signature}`)).toBe(false);
    const header = part({ alg: "RS256", kid: fake.key.kid, typ: "JWT", extra: true });
    expect(await check(`${header}.${body}.${signature}`)).toBe(false);
  });

  it("can't be borrowed from another of Google's tokens, or left out", async () => {
    const [head, body] = token().split(".");
    const other = tokenAt(later(MINUTE)).split(".")[2];
    expect(await check(`${head}.${body}.${other}`)).toBe(false);
    expect(await check(`${head}.${body}.`)).toBe(false);
    expect(await check(`${head}.${body}.AAAA`)).toBe(false);
  });
});

describe("the key", () => {
  // Node checks a signature by the kind of key it is handed, whatever name the check is given: a
  // key of another kind would pass by its own rules if only the header's RS256 were looked at.
  it("must be an RSA key, whatever the header says", async () => {
    const kid = "another-kind";
    const published = { ...elliptic.publicKey.export({ format: "jwk" }), kid, alg: "RS256" };
    fake.options.certs = { keys: [published] };
    const sent = token({ header: { kid }, key: elliptic.privateKey });
    const [head, body, signature] = sent.split(".");
    // The signature is good for that key, and Node would say so under RS256's own name.
    expect(
      verify(
        "RSA-SHA256",
        Buffer.from(`${head}.${body}`),
        elliptic.publicKey,
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true);
    expect(await check(sent)).toBe(false);
    expect(fetches()).toBe(1);
  });

  it("must be one Google publishes: a key id it doesn't know is refused", async () => {
    expect(await check(token({ header: { kid: "made-up" } }))).toBe(false);
    expect(await check(token({ header: { kid: "__proto__" } }))).toBe(false);
    expect(await check(token({ header: { kid: "constructor" } }))).toBe(false);
  });

  it.each([
    ["with no numbers in it", { kty: "RSA" }],
    ["whose numbers aren't text", { kty: "RSA", n: 5, e: 3 }],
    ["that says it is of no kind", { n: "AQAB", e: "AQAB" }],
    ["that says RSA and brings a curve", { kty: "RSA", crv: "P-256", x: "AA", y: "AA" }],
  ])("is refused, without a crash, for a published key %s", async (_what, key) => {
    fake.options.certs = { keys: [{ ...key, kid: "broken" }] };
    expect(await check(token({ header: { kid: "broken" } }))).toBe(false);
  });
});

describe("the times", () => {
  it("refuses a token that ended more than the allowed difference ago", async () => {
    const ended = (ago: number) => token({ claims: { exp: seconds(NOW) - ago } });
    expect(await check(ended(SKEW + 1))).toBe(false);
    expect(await check(ended(SKEW))).toBe(false);
    expect(await check(ended(SKEW - 1))).toBe(true);
    expect(await check(tokenAt(later(-2 * HOUR)))).toBe(false);
  });

  it("refuses a token from further in the future than the allowed difference", async () => {
    const made = (ahead: number) => token({ claims: { iat: seconds(NOW) + ahead } });
    expect(await check(made(SKEW + 1))).toBe(false);
    expect(await check(made(SKEW))).toBe(true);
    expect(await check(tokenAt(later(HOUR)))).toBe(false);
  });

  it.each([
    ["no end", { exp: undefined }],
    ["an end that isn't a number", { exp: "9999999999" }],
    ["no start", { iat: undefined }],
    ["a start that isn't a number", { iat: "0" }],
    ["a start that is null", { iat: null }],
  ])("refuses a token with %s", async (_what, claims) => {
    expect(await check(token({ claims }))).toBe(false);
  });
});

describe("missing settings", () => {
  it.each([
    ["GMAIL_PUSH_AUDIENCE", ""],
    ["GMAIL_PUSH_AUDIENCE", "   "],
    ["GMAIL_PUSH_SERVICE_ACCOUNT", ""],
    ["GMAIL_PUSH_SERVICE_ACCOUNT", " \n"],
  ])("refuse every notice, Google's own included: %s set to %j", async (name, value) => {
    vi.stubEnv(name, value);
    expect(await check(token())).toBe(false);
    expect(fetches()).toBe(0);
  });

  // A token that leaves out, or leaves empty, what an unset setting would have been compared with.
  it.each([
    ["GMAIL_PUSH_AUDIENCE", "aud"],
    ["GMAIL_PUSH_SERVICE_ACCOUNT", "email"],
  ])("aren't matched by a token that leaves the same thing empty: %s", async (name, claim) => {
    vi.stubEnv(name, "");
    expect(await check(token({ claims: { [claim]: "" } }))).toBe(false);
    vi.stubEnv(name, undefined);
    expect(process.env[name]).toBeUndefined();
    expect(await check(token({ claims: { [claim]: undefined } }))).toBe(false);
    expect(fetches()).toBe(0);
  });
});

describe("Google's keys", () => {
  it("are fetched once and kept: later notices cost no fetch", async () => {
    expect(await check(token())).toBe(true);
    expect(await check(tokenAt(later(MINUTE)), later(MINUTE))).toBe(true);
    expect(await check(tokenAt(later(KEPT_MS - 1)), later(KEPT_MS - 1))).toBe(true);
    expect(fetches()).toBe(1);
  });

  it("are fetched again once they have been kept as long as they may be", async () => {
    await check(token());
    expect(await check(tokenAt(later(KEPT_MS)), later(KEPT_MS))).toBe(true);
    expect(fetches()).toBe(2);
  });

  it("come through the one way out, from Google's own address, with no redirect followed", async () => {
    const fetcher = vi.fn(call);
    expect(await verifyGmailWebhook(`Bearer ${token()}`, { now: NOW, fetcher })).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(googleServer().certs);

    clearGmailWebhookKeysForTests();
    const keySet = await (await fetch(googleServer().certs)).text();
    vi.stubEnv("GMAIL_API_URL", "");
    const sent = vi.fn(async (..._request: [string, RequestInit]) => new Response(keySet));
    vi.stubGlobal("fetch", sent);
    expect(await check(token())).toBe(true);
    expect(sent.mock.calls.map(([address]) => address)).toEqual([
      "https://www.googleapis.com/oauth2/v3/certs",
    ]);
    expect(sent.mock.calls[0][1]).toMatchObject({ redirect: "error", cache: "no-store" });
    // No token of anyone's goes with the request for the keys.
    expect(JSON.stringify(sent.mock.calls[0][1].headers)).not.toMatch(/authorization|bearer/i);
  });

  it("survive a failed fetch: Google being unreachable doesn't turn away a key it published", async () => {
    await check(token());
    fake.answerWith("/certs", 500, { times: 10 });
    const hourOn = later(KEPT_MS + MINUTE);
    expect(await check(tokenAt(hourOn), hourOn)).toBe(true);
    expect(fetches()).toBe(2);
    // And Google isn't asked again at once, notice after notice.
    const soonAfter = later(KEPT_MS + MINUTE + 10 * SECOND);
    expect(await check(tokenAt(soonAfter), soonAfter)).toBe(true);
    expect(fetches()).toBe(2);
    const waited = later(KEPT_MS + MINUTE + REFETCH_MS);
    expect(await check(tokenAt(waited), waited)).toBe(true);
    expect(fetches()).toBe(3);
  });

  it.each([
    ["text that isn't a key set", "not a key set"],
    ["keys that aren't a list", { keys: "none" }],
    ["an empty list", { keys: [] }],
    ["keys with no id", { keys: [{ kty: "RSA", n: "AQAB", e: "AQAB" }] }],
    ["more than a key set could ever be", { keys: [], more: "x".repeat(200_000) }],
  ])("keep the set already held when the answer is %s", async (_what, certs) => {
    await check(token());
    fake.options.certs = certs;
    const hourOn = later(KEPT_MS + MINUTE);
    expect(await check(tokenAt(hourOn), hourOn)).toBe(true);
    expect(fetches()).toBe(2);
  });

  it("are never taken from an answer that failed, even one that carries keys", async () => {
    const kid = "from-an-error";
    const theirs = { ...attacker.publicKey.export({ format: "jwk" }), kid, alg: "RS256" };
    fake.answerWith("/certs", 500, { body: { keys: [theirs] } });
    expect(await check(token({ header: { kid }, key: attacker.privateKey }))).toBe(false);
    expect(fetches()).toBe(1);
  });

  it("are read from no more of an answer than a key set needs", async () => {
    const { kid, publicKey } = fake.key;
    const keys = [{ ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" }];
    fake.options.certs = { keys, more: "x".repeat(GMAIL_LIMITS.signInAnswerBytes) };
    expect(await check(token())).toBe(false);
    fake.options.certs = { keys, more: "x".repeat(1_000) };
    expect(await check(token(), later(REFETCH_MS))).toBe(true);
    expect(fetches()).toBe(2);
  });

  it("stop vouching for a key once Google no longer publishes it", async () => {
    const old = fake.key;
    await check(token());
    fake.rotateKeys();
    expect(fake.key.kid).not.toBe(old.kid);
    const signedByOld = (at: Date) =>
      tokenAt(at, { header: { kid: old.kid }, key: old.privateKey });
    // Still held, so still taken.
    expect(await check(signedByOld(later(MINUTE)), later(MINUTE))).toBe(true);
    const hourOn = later(KEPT_MS + MINUTE);
    expect(await check(signedByOld(hourOn), hourOn)).toBe(false);
    expect(await check(tokenAt(hourOn), hourOn)).toBe(true);
  });

  it("are refused to everyone when there are none to be had, and asked for again only after a wait", async () => {
    fake.answerWith("/certs", 503, { times: 1 });
    expect(await check(token())).toBe(false);
    expect(await check(token(), later(10 * SECOND))).toBe(false);
    expect(fetches()).toBe(1);
    expect(await check(tokenAt(later(REFETCH_MS)), later(REFETCH_MS))).toBe(true);
    expect(fetches()).toBe(2);
  });

  it("are refused, without a crash, when the way out itself throws", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("no network");
    });
    expect(await verifyGmailWebhook(`Bearer ${token()}`, { now: NOW, fetcher })).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("are shared by notices that arrive together: one fetch, and none refused for waiting", async () => {
    const held = fake.hold("/certs");
    const together = [check(token()), check(token()), check(token())];
    await held.reached;
    held.release();
    expect(await Promise.all(together)).toEqual([true, true, true]);
    expect(fetches()).toBe(1);
  });
});

describe("key ids nobody has seen", () => {
  // Signed by someone else under a key id of their own invention, with everything else right.
  const forged = (kid: string, at: Date) =>
    tokenAt(at, { header: { kid }, key: attacker.privateKey });

  it("cost one fetch of the whole set, then none until the wait is over", async () => {
    for (let i = 0; i < 50; i++) {
      const at = later(i * SECOND);
      expect(await check(forged(`made-up-${i}`, at), at)).toBe(false);
    }
    expect(fetches()).toBe(1);
    const waited = later(REFETCH_MS);
    for (let i = 0; i < 50; i++)
      expect(await check(forged(`more-${i}`, waited), waited)).toBe(false);
    expect(fetches()).toBe(2);
  });

  it("never turn away a key Jane holds, however many arrive", async () => {
    expect(await check(token())).toBe(true);
    for (let i = 0; i < 50; i++) {
      const at = later(i * SECOND);
      await check(forged(`made-up-${i}`, at), at);
      expect(await check(tokenAt(at), at)).toBe(true);
    }
    expect(fetches()).toBe(1);
  });

  // Plaid's check allows a number of lookups a minute, which made-up ids can use up just before
  // the keys change. Here any fetch brings the whole set, the new key with it.
  it("can't lock out Google's next key: whoever causes the fetch, it brings the new key", async () => {
    expect(await check(token())).toBe(true);
    fake.rotateKeys();
    const waited = later(REFETCH_MS);
    expect(await check(forged("made-up", waited), waited)).toBe(false);
    expect(fetches()).toBe(2);
    const justAfter = later(REFETCH_MS + SECOND);
    expect(await check(tokenAt(justAfter), justAfter)).toBe(true);
    expect(fetches()).toBe(2);
  });

  it("are refused when they name a key the attacker published nowhere Google does", async () => {
    const theirs = token({ header: { kid: "theirs", jku: "https://evil.example/keys" } });
    expect(await check(theirs)).toBe(false);
    expect(fake.requests.every((request) => request.path === "/oauth2/v3/certs")).toBe(true);
  });
});

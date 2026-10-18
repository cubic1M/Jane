import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unsubscribeToken, userFromUnsubscribeToken } from "./unsubscribe";

describe("unsubscribe tokens", () => {
  beforeEach(() => vi.stubEnv("AUTH_SECRET", "test-secret"));
  afterEach(() => vi.unstubAllEnvs());

  it("identify the person they were made for", () => {
    expect(userFromUnsubscribeToken(unsubscribeToken("user_1"))).toBe("user_1");
  });

  it("can't be forged for someone else or tampered with", () => {
    const token = unsubscribeToken("user_1");
    const otherId = Buffer.from("user_2").toString("base64url");

    expect(userFromUnsubscribeToken(`${otherId}.${token.split(".")[1]}`)).toBeNull();
    expect(userFromUnsubscribeToken(`${token}x`)).toBeNull();
    expect(userFromUnsubscribeToken("")).toBeNull();
    expect(userFromUnsubscribeToken(null)).toBeNull();
  });

  it("stop working when the secret changes", () => {
    const token = unsubscribeToken("user_1");
    vi.stubEnv("AUTH_SECRET", "rotated");
    expect(userFromUnsubscribeToken(token)).toBeNull();
  });
});

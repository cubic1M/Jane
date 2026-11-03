import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { ipKey } from "./rate-limit";

const key = (ip: string) => ipKey(new Headers({ "x-forwarded-for": ip }));

describe("ipKey", () => {
  // One customer holds a whole /64: a new address per request walked past every limit per IP.
  it("counts an IPv6 network as one caller, however it's written", () => {
    const one = key("2001:db8:1:2:aaaa:bbbb:cccc:dddd");
    expect(key("2001:db8:1:2:1111:2222:3333:4444")).toBe(one);
    expect(key("2001:DB8:1:2::9")).toBe(one);
    expect(key("2001:0db8:0001:0002::")).toBe(one);
  });

  it("keeps different IPv6 networks apart", () => {
    expect(key("2001:db8:1:3::1")).not.toBe(key("2001:db8:1:2::1"));
    expect(key("2001:db8::1")).toBe(key("2001:db8:0:0:ffff::1"));
    expect(key("::1")).toBe(key("0:0:0:0:1::"));
  });

  it("reads an IPv4 address the same in either dress, and keeps each apart", () => {
    expect(key("::ffff:203.0.113.7")).toBe(key("203.0.113.7"));
    expect(key("203.0.113.7")).not.toBe(key("203.0.113.8"));
  });

  it("leaves what isn't an address as it is", () => {
    expect(key("unknown")).not.toBe(key("203.0.113.7"));
  });
});

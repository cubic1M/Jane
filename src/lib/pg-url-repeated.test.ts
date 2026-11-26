import { describe, expect, it } from "vitest";
import { withVerifyFull } from "./pg-url";

// pg goes by the last sslmode in the address; the rewrite read the first.
const BASE = "postgresql://u@db.test/jane";

describe("an address that names sslmode twice", () => {
  it("is left as it is when the one pg goes by turns TLS off", () => {
    const url = `${BASE}?sslmode=require&sslmode=disable`;
    expect(withVerifyFull(url)).toBe(url);
  });

  it("is checked in full when the one pg goes by asks for TLS", () => {
    expect(withVerifyFull(`${BASE}?sslmode=disable&sslmode=require`)).toBe(
      `${BASE}?sslmode=verify-full`,
    );
  });
});

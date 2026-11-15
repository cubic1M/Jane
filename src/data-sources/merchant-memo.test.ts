import { describe, expect, it } from "vitest";
import { normalizeMerchant } from "./merchant";

// normalizeMerchant keeps each answer (a page reads the same descriptions many times). Kept or not,
// the answer is the same, and no caller can change the next one.
describe("normalizeMerchant's memo", () => {
  it("answers the same the second time", () => {
    const first = normalizeMerchant("NETFLIX.COM NETFLIX.COM CA");
    expect(first).toEqual({ name: "Netflix", key: "netflix" });
    expect(normalizeMerchant("NETFLIX.COM NETFLIX.COM CA")).toEqual(first);
    expect(normalizeMerchant("PAYMENT THANK YOU 000123")).toEqual(
      normalizeMerchant("PAYMENT THANK YOU 000123"),
    );
  });

  it("never lets a caller change the next answer", () => {
    const first = normalizeMerchant("SPOTIFY USA        SAN FRANCISCO  CA");
    expect(first).not.toBeNull();
    first!.name = "changed";
    first!.key = "changed";
    expect(normalizeMerchant("SPOTIFY USA        SAN FRANCISCO  CA")).toEqual({
      name: "Spotify Usa",
      key: "spotify usa",
    });
  });

  it("reads only the first 300 characters, as before", () => {
    const long = `AMAZON.COM ${"X".repeat(400)}`;
    expect(normalizeMerchant(long)).toEqual(normalizeMerchant(long.slice(0, 300)));
    expect(normalizeMerchant(`${long} WALMART`)).toEqual(normalizeMerchant(long));
  });

  it("keeps answering after the memo fills", () => {
    for (let i = 0; i < 10_050; i++) normalizeMerchant(`SHOP ${"A".repeat(i % 50)} ${i}X`);
    expect(normalizeMerchant("NETFLIX.COM")).toEqual({ name: "Netflix", key: "netflix" });
  });
});

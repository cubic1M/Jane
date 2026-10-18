import { describe, expect, it } from "vitest";
import { scrub, scrubPath } from "./scrub";

describe("scrub", () => {
  it.each([
    ["Failed for jane.doe+test@example.com", "Failed for [email]"],
    ["token access-sandbox-123e4567-e89b-12d3", "token [plaid-token]"],
    ["public-production-abc-123 rejected", "[plaid-token] rejected"],
    ["key sk_live_51Habc123 bad", "key [key] bad"],
    ["secret whsec_abc123XYZ", "secret [key]"],
    ["anthropic sk-ant-api03-abc_def", "anthropic [key]"],
    ["Authorization: Bearer abc.def.ghi", "Authorization: Bearer [token]"],
    ["card 4111 1111 1111 1111 declined", "card [number] declined"],
    ["account 000123456789", "account [number]"],
    ["db postgresql://user:pass@host:5432/db failed", "db [database-url] failed"],
  ])("removes %j", (input, expected) => {
    expect(scrub(input)).toBe(expected);
  });

  it("keeps ordinary text, short numbers and ids", () => {
    expect(scrub("Finding cmvdit81i001f not found (HTTP 404), 3 tries")).toBe(
      "Finding cmvdit81i001f not found (HTTP 404), 3 tries",
    );
  });
});

describe("scrubPath", () => {
  it("drops the query string", () => {
    expect(scrubPath("/unsubscribe?token=abc.def")).toBe("/unsubscribe");
    expect(scrubPath(undefined)).toBeNull();
  });
});

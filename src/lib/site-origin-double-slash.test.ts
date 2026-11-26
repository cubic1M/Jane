import { describe, expect, it } from "vitest";
import { linkOnSite } from "./site-origin";

const env = { APP_URL: "https://jane.example" };

describe("a link whose path starts with two slashes", () => {
  it("stays on the site's own address", () => {
    const link = new URL(
      linkOnSite("https://input.example//other.example/path?token=example", env),
    );
    expect(link.origin).toBe("https://jane.example");
    expect(link.searchParams.get("token")).toBe("example");
  });
});

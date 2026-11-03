import { expect, it } from "vitest";
import { value } from "@/lib/gates-demo-value";

it("is two", () => {
  expect(value).toBe(2);
});

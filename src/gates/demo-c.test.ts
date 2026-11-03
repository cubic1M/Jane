import { expect, it } from "vitest";
import { brandNewHelper } from "@/lib/gates-demo-helper";

it("helper", () => {
  expect(brandNewHelper()).toBe(1);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { total } from "./invoice.js";

test("a total counts quantity", () => {
  assert.equal(total([{ cents: 250, quantity: 2 }]), 500);
});

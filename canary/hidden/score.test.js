import assert from "node:assert/strict";
import { test } from "node:test";
import { format, pastDue, split, total } from "./invoice.js";

test("total: quantity, discount, half a cent up", () => {
  assert.equal(total([{ cents: 250, quantity: 2 }]), 500);
  assert.equal(total([{ cents: 100, quantity: 3 }, { cents: 50, quantity: 1 }], 10), 315);
  assert.equal(total([{ cents: 5, quantity: 1 }], 50), 3);
  assert.equal(total([], 10), 0);
  assert.equal(total([{ cents: 1999, quantity: 1 }], 100), 0);
});

test("split: adds up exactly, earlier people take the extra", () => {
  assert.deepEqual(split(100, 3), [34, 33, 33]);
  assert.deepEqual(split(101, 3), [34, 34, 33]);
  assert.deepEqual(split(99, 3), [33, 33, 33]);
  assert.deepEqual(split(0, 2), [0, 0]);
});

test("format: commas, two digits, negatives", () => {
  assert.equal(format(123405), "$1,234.05");
  assert.equal(format(-50), "-$0.50");
  assert.equal(format(5), "$0.05");
  assert.equal(format(100000000), "$1,000,000.00");
  assert.equal(format(0), "$0.00");
});

test("pastDue: due today isn't", () => {
  assert.equal(pastDue("2026-01-02", "2026-01-02"), false);
  assert.equal(pastDue("2026-01-01", "2026-01-02"), true);
  assert.equal(pastDue("2026-01-03", "2026-01-02"), false);
});

import { describe, expect, it } from "vitest";
import { crossFormatTwins, type RowFacts } from "./cross-format";

const csv = (date: string, amountCents: number, description: string, n = 0): RowFacts => ({
  key: `hash${date}${amountCents}${n}`,
  date,
  amountCents,
  description,
});
const ofx = (date: string, amountCents: number, description: string, id = date): RowFacts => ({
  key: `ofx:${id}${amountCents}`,
  date,
  amountCents,
  description,
});

describe("crossFormatTwins", () => {
  it("drops a QFX row whose CSV twin is already there, its name cut at 32 letters", () => {
    const existing = [csv("2026-10-01", 1549, "NETFLIX.COM 866-579-7172 CA RECURRING PAYMENT")];
    const incoming = [
      ofx("2026-10-01", 1549, "NETFLIX.COM 866-579-7172 CA RECU"),
      ofx("2026-10-02", 6500, "PG&E WEB ONLINE"),
    ];
    expect([...crossFormatTwins(existing, incoming)]).toEqual([0]);
  });

  it("pairs a day apart (a posting date beside a transaction date), a whole file a day off too", () => {
    const existing = [
      csv("2026-10-02", 450, "STARBUCKS STORE 1"),
      csv("2026-10-03", 450, "STARBUCKS STORE 1", 1),
    ];
    const incoming = [
      ofx("2026-10-03", 450, "STARBUCKS STORE 1", "a"),
      ofx("2026-10-04", 450, "STARBUCKS STORE 1", "b"),
    ];
    expect([...crossFormatTwins(existing, incoming)]).toEqual([0, 1]);
  });

  it("keeps two real coffees: each twin pairs once", () => {
    const existing = [csv("2026-10-02", 450, "STARBUCKS STORE 1")];
    const incoming = [
      ofx("2026-10-02", 450, "STARBUCKS STORE 1", "a"),
      ofx("2026-10-02", 450, "STARBUCKS STORE 1", "b"),
    ];
    expect([...crossFormatTwins(existing, incoming)]).toEqual([0]);
  });

  it("never pairs within one format, another amount, other words, or days further apart", () => {
    const existing = [csv("2026-10-01", 1549, "NETFLIX.COM")];
    expect(crossFormatTwins(existing, [csv("2026-10-01", 1549, "NETFLIX.COM", 1)]).size).toBe(0);
    expect(crossFormatTwins(existing, [ofx("2026-10-01", 1599, "NETFLIX.COM")]).size).toBe(0);
    expect(crossFormatTwins(existing, [ofx("2026-10-01", 1549, "HULU")]).size).toBe(0);
    expect(crossFormatTwins(existing, [ofx("2026-10-03", 1549, "NETFLIX.COM")]).size).toBe(0);
  });

  it("finds twins within one upload too: a CSV and a QFX of the same months together", () => {
    const incoming = [
      csv("2026-10-01", -250000, "INITECH PAYROLL"),
      ofx("2026-10-01", -250000, "INITECH PAYROLL"),
    ];
    expect([...crossFormatTwins([], incoming)]).toEqual([1]);
  });
});

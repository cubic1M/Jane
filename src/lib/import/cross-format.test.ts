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

describe("what counts as the same words", () => {
  const twins = (a: string, b: string) =>
    crossFormatTwins([csv("2026-10-01", 100, a)], [ofx("2026-10-01", 100, b)]).size === 1;

  it("takes a cut name whichever side is cut", () => {
    expect(twins("NETFLIX.COM RECURRING", "NETFLIX.COM")).toBe(true);
    expect(twins("NETFLIX.COM", "NETFLIX.COM RECURRING")).toBe(true);
    expect(twins("SAME", "SAME")).toBe(true);
  });

  it("takes a name inside the other only at six letters or more", () => {
    expect(twins("POS NETFLIX.COM", "NETFLI")).toBe(true);
    expect(twins("POS NETFLIX.COM", "NETFL")).toBe(false);
  });

  it("takes a short name at the start, but not one at the end", () => {
    expect(twins("SHELL OIL", "SHE")).toBe(true);
    expect(twins("SHELL OIL", "OIL")).toBe(false);
  });

  it("never pairs a name with nothing to read", () => {
    expect(twins("###", "NETFLIX")).toBe(false);
    expect(twins("NETFLIX", "---")).toBe(false);
    expect(twins("###", "---")).toBe(false);
  });
});

describe("which rows pair", () => {
  it("pairs two days apart with neither, and a day either side with both", () => {
    const at = (date: string) =>
      crossFormatTwins([csv("2026-10-03", 100, "SHOP")], [ofx(date, 100, "SHOP")]).size;
    expect(at("2026-10-01")).toBe(0);
    expect(at("2026-10-02")).toBe(1);
    expect(at("2026-10-04")).toBe(1);
    expect(at("2026-10-05")).toBe(0);
  });

  it("works through rows in date order, each taking the earliest twin", () => {
    // Given newest first, the later row would otherwise take the earlier one's twin and leave the
    // earlier with nothing.
    const existing = [csv("2026-10-01", 100, "SHOP", 1), csv("2026-10-02", 100, "SHOP", 2)];
    const incoming = [ofx("2026-10-02", 100, "SHOP", "b"), ofx("2026-10-01", 100, "SHOP", "a")];
    expect([...crossFormatTwins(existing, incoming)].sort()).toEqual([0, 1]);
  });
});

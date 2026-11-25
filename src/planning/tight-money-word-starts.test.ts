import { describe, expect, it } from "vitest";
import { essentialGroup } from "./tight-money";

// CodeRabbit sweep 1c, pl-09 #2: essential words match where a word starts, not inside one.

describe("essentialGroup matches word starts", () => {
  it("keeps the real bills", () => {
    expect(essentialGroup("ACME RENT PAYMENT")).toBe("housing");
    expect(essentialGroup("PG&E WEB ONLINE")).toBe("utilities");
    expect(essentialGroup("Rent - Oak Street")).toBe("housing");
    expect(essentialGroup("ACH-RENT")).toBe("housing");
    expect(essentialGroup("PowerSchool")).toBe("utilities");
    expect(essentialGroup("Monthly premium")).toBe("insurance");
  });

  it("does not match inside another word", () => {
    expect(essentialGroup("Parent Teacher Store")).toBeNull();
    expect(essentialGroup("Different Strokes")).toBeNull();
    expect(essentialGroup("Torrent Tech")).toBeNull();
    expect(essentialGroup("Backwater Books")).toBeNull();
    expect(essentialGroup("Smartphone Repair")).toBeNull();
  });
});

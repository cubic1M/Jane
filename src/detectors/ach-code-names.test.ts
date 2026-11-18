import { describe, expect, it } from "vitest";
import { nice } from "./helpers";

// Debugger 11-18 (r346, Chase checking paying "GEICO AUTO PPD ID: 3334445556", on a phone): the
// car cover card said "You pay Geico Auto Ppd Id: about $1,711.20 a year". The company ID went as a
// phone number and left the entry code behind. A name says the payee, as the report's did ("Your
// GEICO insurance could cost less").

describe("a payee's name from a Chase ACH line", () => {
  it("leaves out the entry code and company ID", () => {
    expect(nice("GEICO AUTO PPD ID: 3334445556")).toBe("Geico Auto");
    expect(nice("NELNET STUDENT LOAN PPD ID: 5556667778")).toBe("Nelnet Student Loan");
    expect(nice("AVALON AUSTIN RENT WEB ID: 1112223334")).toBe("Avalon Austin Rent");
  });

  it("keeps a name that only looks like one", () => {
    expect(nice("COMCAST CABLE COMM 800-COMCAST TX")).toBe("Comcast Cable Comm");
  });
});

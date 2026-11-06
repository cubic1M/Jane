import { describe, expect, it } from "vitest";
import { fromTheCompany } from "./mail";

// Whose reply is acted on (#1477): only the company Jane wrote to. Debugger 11-06: comparing the
// last two parts of the domain let any .co.uk address, or any Gmail user, pass as the company.
describe("a reply from the company Jane wrote to", () => {
  it("is the company's own domain, a subdomain of it, or its address with a name", () => {
    expect(fromTheCompany("Acme <support@acme.example>", "support@acme.example")).toBe(true);
    expect(fromTheCompany("billing@ACME.EXAMPLE", "support@acme.example")).toBe(true);
    expect(fromTheCompany("help@mail.acme.example", "support@acme.example")).toBe(true);
    expect(fromTheCompany("care@bigco.co.uk", "support@bigco.co.uk")).toBe(true);
  });

  it("isn't another company that shares an ending", () => {
    expect(fromTheCompany("anyone@other.co.uk", "support@bigco.co.uk")).toBe(false);
    expect(fromTheCompany("anyone@shop.com.au", "help@bigco.com.au")).toBe(false);
  });

  it("isn't another person on the same free mail", () => {
    expect(fromTheCompany("stranger@gmail.com", "smallshop@gmail.com")).toBe(false);
    expect(fromTheCompany("SmallShop <smallshop@gmail.com>", "smallshop@gmail.com")).toBe(true);
  });

  it("isn't a From line with someone else's address in it", () => {
    expect(fromTheCompany("evil@attacker.test, support@acme.example", "support@acme.example")).toBe(
      false,
    );
    expect(
      fromTheCompany('"support@acme.example" <evil@attacker.test>', "support@acme.example"),
    ).toBe(false);
    expect(fromTheCompany("evil@acme.example.attacker.test", "support@acme.example")).toBe(false);
  });
});

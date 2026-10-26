import { describe, expect, it } from "vitest";
import { CONTACT_PLACEHOLDER, contactEmail } from "./legal";

// The legal pages' contact address: the support inbox, else a founder's admin address, else a
// placeholder that says one is still to be set (never an address nobody reads).
describe("the legal pages' contact address", () => {
  it("is SUPPORT_EMAIL when set", () => {
    expect(contactEmail({ SUPPORT_EMAIL: "help@jane.example", ADMIN_EMAILS: "a@x.com" })).toBe(
      "help@jane.example",
    );
  });

  it("else the first founder address in ADMIN_EMAILS", () => {
    expect(contactEmail({ ADMIN_EMAILS: " , founder@jane.example, other@jane.example" })).toBe(
      "founder@jane.example",
    );
  });

  it("else a clear placeholder, never the sending address", () => {
    expect(contactEmail({ EMAIL_FROM: "Jane <noreply@jane.example>" })).toBe(CONTACT_PLACEHOLDER);
    expect(CONTACT_PLACEHOLDER).toMatch(/to be added/);
  });
});

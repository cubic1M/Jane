import { describe, expect, it } from "vitest";
import { CANCEL_METHODS } from "@/config/cancel-methods";
import { connectorById } from "../registry";
import { billedVia, cancelRoute, knownMerchant } from "./route";

describe("the cancel methods table", () => {
  it("has a source for every row, on the web", () => {
    expect(CANCEL_METHODS).toHaveLength(56);
    for (const row of CANCEL_METHODS) {
      expect(row.sources.length, row.merchant).toBeGreaterThan(0);
      for (const source of row.sources) expect(source, row.merchant).toMatch(/^https:\/\//);
      expect(row.steps.length, row.merchant).toBeGreaterThan(0);
      expect(row.aliases.length, row.merchant).toBeGreaterThan(0);
    }
  });

  it("keeps an email only where the merchant's own page takes a cancellation by email", () => {
    const withEmail = CANCEL_METHODS.filter((row) => row.email).map((row) => row.merchant);
    expect(withEmail.sort()).toEqual(["Blue Apron", "Equinox", "Headspace"]);
    // And email is the first channel only where the research made it so.
    const emailFirst = CANCEL_METHODS.filter((row) => row.channel === "email");
    expect(emailFirst.map((row) => row.merchant).sort()).toEqual(["Blue Apron", "Equinox"]);
  });

  it("gives no two merchants the same alias", () => {
    const aliases = CANCEL_METHODS.flatMap((row) => row.aliases);
    expect(new Set(aliases).size).toBe(aliases.length);
  });
});

describe("billedVia", () => {
  it("reads the app stores from the charge's descriptor", () => {
    expect(billedVia("APPLE.COM/BILL 866-712-7753 CA")).toBe("apple");
    expect(billedVia("GOOGLE *YouTubePremium g.co/helppay#")).toBe("google");
    expect(billedVia("NETFLIX.COM LOS GATOS CA")).toBeNull();
    expect(billedVia(null)).toBeNull();
  });
});

describe("knownMerchant", () => {
  it("finds a merchant by its name or its charge, the longest alias first", () => {
    expect(knownMerchant("Netflix")?.merchant).toBe("Netflix");
    expect(knownMerchant(null, "OPENAI *CHATGPT SUBSCR")?.merchant).toBe("ChatGPT Plus (OpenAI)");
    expect(knownMerchant("Verizon Fios")?.merchant).toBe("Verizon Fios (home)");
    expect(knownMerchant("Unknown Gym Co")).toBeNull();
    // A word inside another isn't a match.
    expect(knownMerchant("Ringling Bros")).toBeNull();
  });
});

describe("cancelRoute", () => {
  it("sends an app-store charge to the app store, whatever the merchant's own route", () => {
    const route = cancelRoute({ merchant: "Equinox", descriptor: "APPLE.COM/BILL" });
    expect(route).toMatchObject({ channel: "app_store", billedVia: "apple", email: null });
    expect(route.steps[0]!.value).toMatch(/Settings > your name > Subscriptions/);
    expect(
      cancelRoute({ merchant: "YouTube Premium", descriptor: "GOOGLE *YouTube" }).channel,
    ).toBe("app_store");
  });

  it("emails only where the merchant documents it", () => {
    expect(cancelRoute({ merchant: "Equinox" })).toMatchObject({
      channel: "email",
      email: "Cancellations@Equinox.com",
    });
    // Headspace takes an email only when its button is missing: the steps come first.
    expect(cancelRoute({ merchant: "Headspace" })).toMatchObject({
      channel: "guided",
      email: null,
    });
    expect(cancelRoute({ merchant: "Netflix" })).toMatchObject({ channel: "guided", email: null });
  });

  it("writes a letter where written notice is the way, and never calls", () => {
    expect(cancelRoute({ merchant: "LA Fitness" }).channel).toBe("letter");
    const phoneOnly = cancelRoute({ merchant: "Costco" });
    expect(phoneOnly.channel).toBe("guided");
    expect(phoneOnly.steps.map((s) => s.value).join(" ")).toMatch(/membership counter/);
  });

  it("gives plain steps for a merchant it doesn't know", () => {
    const route = cancelRoute({ merchant: "Unknown Gym Co" });
    expect(route).toMatchObject({ channel: "guided", method: null });
    expect(route.steps[0]!.value).toContain("Unknown Gym Co");
  });
});

describe("the sandbox cancel connector", () => {
  const cancel = connectorById("sandbox_subscription_cancel")!;

  it("puts the route in the steps the person says yes to", () => {
    const draft = cancel.prefill!({
      merchant: "Equinox",
      monthlyCents: 26_000,
      descriptor: "EQUINOX 0123 NEW YORK NY",
    });
    const equinox = CANCEL_METHODS.find((row) => row.merchant === "Equinox")!;
    expect(draft.steps.map((s) => s.label)).toEqual([
      "Cancel",
      "Saves",
      "How",
      "Email to",
      ...equinox.steps.map((_, i) => `Step ${i + 1}`),
    ]);
    expect(draft.details).toMatchObject({ channel: "email", email: "Cancellations@Equinox.com" });
    const apple = cancel.prefill!({
      merchant: "Equinox",
      monthlyCents: 26_000,
      descriptor: "APPLE.COM/BILL",
    });
    expect(apple.details).toMatchObject({ channel: "app_store", email: null });
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { validateMerchant, type MerchantInput } from "./merchants";

const input = (overrides: Partial<MerchantInput> = {}): MerchantInput => ({
  name: "Streamflix",
  key: "",
  aliases: "STREAMFLIX.COM, Streamflix Inc, streamflix",
  category: "ENTERTAINMENT_TV_AND_MOVIES",
  cancelUrl: "https://streamflix.example/account",
  supportUrl: "",
  supportPhone: "1 (800) 555-0100",
  supportEmail: "",
  typicalMonthly: "12.99",
  reviewed: true,
  ...overrides,
});

describe("validateMerchant", () => {
  it("normalizes the key and aliases the way statements are matched", () => {
    expect(validateMerchant(input())).toEqual({
      ok: true,
      data: {
        key: "streamflix",
        name: "Streamflix",
        aliases: ["streamflix inc"],
        category: "ENTERTAINMENT_TV_AND_MOVIES",
        cancelUrl: "https://streamflix.example/account",
        supportUrl: null,
        supportPhone: "1 (800) 555-0100",
        supportEmail: null,
        typicalMonthlyCents: 1_299,
      },
    });
  });

  it.each([
    [{ name: "" }, "name"],
    [{ category: "STREAMING" }, "category"],
    [{ cancelUrl: "http://streamflix.example" }, "https"],
    [{ cancelUrl: "javascript:alert(1)" }, "https"],
    // Login details in a link look like an email address, and are refused as one.
    [{ supportUrl: "https://user:pass@streamflix.example" }, "email"],
    [{ supportPhone: "call us" }, "phone"],
    [{ typicalMonthly: "lots" }, "Typical price"],
  ])("rejects %j", (overrides, message) => {
    const result = validateMerchant(input(overrides));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain(message);
  });

  it("keeps a company's support email, but never a personal mail address", () => {
    expect(validateMerchant(input({ supportEmail: " Support@Streamflix.example " }))).toMatchObject(
      {
        ok: true,
        data: { supportEmail: "support@streamflix.example" },
      },
    );
    for (const supportEmail of ["jordan@gmail.com", "help@outlook.com", "not an email"]) {
      expect(validateMerchant(input({ supportEmail }))).toMatchObject({ ok: false });
    }
  });

  it("refuses anything that looks like a person's email", () => {
    for (const overrides of [
      { aliases: "jordan.rivera@example.com" },
      { name: "Help jordan@example.com" },
    ]) {
      expect(validateMerchant(input(overrides))).toMatchObject({ ok: false });
    }
  });
});

describe("merchants table", () => {
  const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
  const model = schema.match(/model Merchant \{([\s\S]*?)\n\}/)?.[1] ?? "";

  it("holds no personal data: no link to users and no personal fields", () => {
    expect(model).not.toBe("");
    const fields = model
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("//") && !line.startsWith("@@"))
      .map((line) => line.split(/\s+/)[0]);
    expect(fields.sort()).toEqual(
      [
        "aliases",
        "cancelUrl",
        "category",
        "createdAt",
        "id",
        "key",
        "name",
        "reviewedAt",
        // The company's own address (validated: never a personal mail service).
        "supportEmail",
        // One the agent found on the company's own site, until the team confirms it.
        "suggestedAt",
        "suggestedSupportEmail",
        "suggestedSupportSource",
        "supportPhone",
        "supportUrl",
        "typicalMonthlyCents",
        "updatedAt",
      ].sort(),
    );
    // Nothing else mentions users or email: only the company support addresses above.
    expect(model.replace(/^\s*(supportEmail|suggestedSupportEmail)\b.*$/gm, "")).not.toMatch(
      /\bUser\b|userId|email|account/i,
    );
  });
});

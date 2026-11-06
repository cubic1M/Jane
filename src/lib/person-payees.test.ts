import { describe, expect, it } from "vitest";
import {
  PERSON,
  initialsOf,
  looksLikePersonPayee,
  redactPersonPayees,
  redactRequestBody,
} from "./person-payees";

// People's names from payment apps never reach Claude (roadmap research round 11).

describe("redactPersonPayees", () => {
  it.each([
    ["ZELLE TO DANIEL SMITH", `ZELLE TO ${PERSON}`],
    ["Zelle payment to Daniel Smith Conf# ABC123", `Zelle payment to ${PERSON} Conf# ABC123`],
    ["ZELLE FROM EMILY ROSE ON 11/02 REF # 123", `ZELLE FROM ${PERSON} ON 11/02 REF # 123`],
    ["VENMO PAYMENT 1023456789 EMILY ROSE", `VENMO PAYMENT 1023456789 ${PERSON}`],
    ["VENMO *Emily Rose", `VENMO *${PERSON}`],
    ["CASH APP*JOHN DOE*", `CASH APP*${PERSON}*`],
    ["Apple Cash Sent Money to Maria Lopez", `Apple Cash Sent Money to ${PERSON}`],
    ["SQ *CASH TO JORDAN LEE 4482", `SQ *CASH TO ${PERSON} 4482`],
    // A landlord by Zelle is redacted too: Claude needs that it's rent, not who.
    ["ZELLE TO OAK RIDGE APTS", `ZELLE TO ${PERSON}`],
  ])("%s", (text, redacted) => {
    expect(redactPersonPayees(text)).toBe(redacted);
  });

  it("leaves prose about the apps and other merchants alone", () => {
    for (const text of [
      "If you send or get a big transfer on Venmo, Zelle or Cash App, I'll ask you once.",
      "payment-app transfers (Venmo, Zelle, Cash App) of $100 or more",
      "Zelle to your landlord counts as rent",
      "NETFLIX.COM 866-579-7172 CA",
      "Trader Joe's #123",
    ]) {
      expect(redactPersonPayees(text)).toBe(text);
    }
  });

  it("redacts every string in a request body, but not file data", () => {
    const body = JSON.stringify({
      system: "You classify merchants.",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: '{"merchants":["ZELLE TO DANIEL SMITH","COSTCO"]}' },
            { type: "document", source: { type: "base64", data: "ZELLE TO DANIEL SMITH" } },
            { type: "tool_result", content: "Sent: Venmo payment to Emily Rose, $40" },
          ],
        },
      ],
    });
    const out = redactRequestBody(body);
    expect(out).not.toContain('DANIEL SMITH\\",\\"COSTCO');
    expect(out).not.toContain("Emily Rose");
    expect(out).toContain("COSTCO");
    expect(JSON.parse(out).messages[0].content[1].source.data).toBe("ZELLE TO DANIEL SMITH");
    const plain = JSON.stringify({ messages: [{ role: "user", content: "COSTCO" }] });
    expect(redactRequestBody(plain)).toBe(plain);
  });
});

describe("looksLikePersonPayee", () => {
  it("catches people and payment apps, not businesses", () => {
    for (const person of ["DANIEL SMITH", "Emily R Rose", "VENMO 4421", "Zelle Transfer"]) {
      expect(looksLikePersonPayee(person)).toBe(true);
    }
    for (const business of [
      "TRADER JOE S",
      "DANIEL SMITH DDS",
      "JOHN SMITH LAW GROUP",
      "NETFLIX",
      "BEST BUY 00123",
      "COSTCO WHSE",
      "MARY",
    ]) {
      expect(looksLikePersonPayee(business)).toBe(false);
    }
  });

  it("gives initials for a person the chat must tell apart", () => {
    expect(initialsOf("Daniel Smith")).toBe("D. S.");
    expect(initialsOf("")).toBe("someone");
  });
});

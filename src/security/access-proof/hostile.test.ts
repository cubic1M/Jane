import { describe, expect, it } from "vitest";
import {
  bodyFields,
  exportedParameters,
  fieldLiterals,
  HostileForm,
  hostileArguments,
  hostileParams,
  queryFields,
  valueForField,
} from "./hostile";

const target = { rowId: "crow", userId: "cuser" };
const none = new Map<string, string[]>();

describe("what an attacker sends", () => {
  it("the victim's id for anything that looks like one", () => {
    for (const name of ["id", "accountId", "findingId", "debtKey", "token", "account_id"]) {
      expect(valueForField(name, target, none)).toBe("crow");
    }
    expect(valueForField("userId", target, none)).toBe("cuser");
    expect(valueForField("partnerId", target, none)).toBe("cuser");
  });

  it("something believable for the rest, so the attack gets past validation", () => {
    expect(valueForField("amountCents", target, none)).toBe("100");
    expect(valueForField("email", target, none)).toContain("@");
    expect(valueForField("date", target, none)).toMatch(/^\d{4}-06-01$/);
  });

  it("the value the code compares a field against, when it has one", () => {
    const literals = fieldLiterals(`
      if (form.get("choice") === "yes") {}
      if (mode !== "all") {}
      if (typeof amount !== "number") {}
    `);
    expect(literals.has("amount")).toBe(false);
    expect(valueForField("choice", target, literals)).toBe("yes");
    expect(valueForField("mode", target, literals)).toBe("all");
  });

  it("a form that answers every field", () => {
    const form = new HostileForm(target, none);
    expect(form.get("accountId")).toBe("crow");
    expect(form.getAll("findingId")).toEqual(["crow"]);
    expect(form.has("anything")).toBe(true);
    expect(form.get("file")).toBeInstanceOf(File);
    expect(form.asked).toContain("accountId");
  });

  it("arguments from the signature", () => {
    const parameters = exportedParameters(`
      export async function a(formData: FormData) {}
      export async function b(_previous: State, formData: FormData) {}
      export async function c(id: string, count: number, on: boolean, ids: string[]) {}
      export async function d(choice: "yes" | "no") {}
      export async function e(previous: Pick) {}
      export const f = async (input: Input) => {};
    `);
    const args = (name: string) => hostileArguments(parameters.get(name), target, none);
    expect(args("a")[0]).toBeInstanceOf(HostileForm);
    expect(args("b")[0]).toBeNull();
    expect(args("b")[1]).toBeInstanceOf(HostileForm);
    expect(args("c")).toEqual(["crow", 100, true, ["crow"]]);
    expect(args("d")).toEqual(["yes"]);
    expect((args("e")[0] as Record<string, string>).strategyId).toBe("crow");
    expect((args("f")[0] as Record<string, string>).accountId).toBe("crow");
  });

  it("an unknown export still gets a form", () => {
    expect(hostileArguments(undefined, target, none)[0]).toBeInstanceOf(HostileForm);
  });

  it("URL segments and search params under any name", () => {
    expect(hostileParams(target).decisionId).toBe("crow");
  });

  it("finds what a route reads from its body and query", () => {
    const source = `
      const { findingId, choice: picked } = body;
      const amount = payload.amountCents;
      const when = url.searchParams.get("since");
    `;
    expect(bodyFields(source)).toEqual(
      expect.arrayContaining(["findingId", "choice", "amountCents", "since"]),
    );
    expect(queryFields(source)).toEqual(["since"]);
  });
});

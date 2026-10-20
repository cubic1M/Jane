import { describe, expect, it } from "vitest";
import { PEOPLE } from "@/config/people";
import { pickPerson } from "./people";

describe("pickPerson", () => {
  it("gives the person asked for, one of the eight on any, and none otherwise", () => {
    expect(pickPerson("retiree")).toBe("retiree");
    expect(pickPerson("any", () => 0)).toBe(PEOPLE[0].id);
    expect(pickPerson("any", () => 0.999)).toBe(PEOPLE[PEOPLE.length - 1].id);
    expect(pickPerson("nobody")).toBeUndefined();
    expect(pickPerson(null)).toBeUndefined();
  });
});

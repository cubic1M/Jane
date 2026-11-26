import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { factsFromChat } from "./from-chat";

// What a chat message says about the person, by rules: no model call.

const said = (text: string) => Object.fromEntries(factsFromChat(text).map((f) => [f.key, f.value]));

describe("facts from the chat", () => {
  it("reads home, household, work and study", () => {
    expect(said("I rent, and I live with my girlfriend.")).toEqual({
      housing: "rent",
      household: "couple",
    });
    expect(said("We just bought our house!")).toEqual({});
    expect(said("I just bought a house in March")).toEqual({ housing: "own" });
    expect(said("I have two kids and a dog")).toEqual({
      has_children: true,
      household: "family",
    });
    expect(said("I'm a college student and I work at Blue Bottle Coffee.")).toEqual({
      is_student: true,
      employer: "Blue Bottle Coffee",
    });
    expect(said("I don't have a car")).toEqual({ has_car: false });
    expect(said("I work from home, I'm 29 years old")).toEqual({ work_style: "remote", age: 29 });
  });

  it("reads goals and how they like to do things", () => {
    expect(said("I'm saving for a wedding next year")).toEqual({ "goal:wedding": "wedding" });
    expect(said("my goal is to pay off my credit card by June")).toEqual({
      "goal:pay_off_credit_card": "pay off credit card",
    });
    expect(said("I'd rather do it myself")).toEqual({ prefers_diy: true });
  });

  it("reads a payday the way Remember this does", () => {
    expect(said("Thanks. My payday is the 1st and 15th.")).toEqual({ payday: "1,15" });
  });

  it("finds nothing in a plain question", () => {
    expect(factsFromChat("how much did I spend on food last month?")).toEqual([]);
    expect(factsFromChat("I need help with my budget")).toEqual([]);
    expect(factsFromChat("can I rent out my spare room?")).toEqual([]);
  });

  // CodeRabbit part 2: each of these used to be kept as a high-confidence fact about the person.
  it("does not take a car rental for a home, a denial for a side gig, or a diagnosis for a goal", () => {
    expect(said("I rent a car for work")).toEqual({});
    expect(said("I rent my apartment from a friend")).toEqual({ housing: "rent" });
    expect(said("I rent in Oakland.")).toEqual({ housing: "rent" });
    expect(said("I don't have a side gig")).toEqual({});
    expect(said("I have a side gig")).toEqual({ side_gig: true });
    expect(said("I'm saving for epilepsy treatment")).toEqual({});
    expect(said("I'm saving for a car")).toEqual({ "goal:car": "car" });
  });

  it("labels each fact in plain words", () => {
    expect(factsFromChat("I rent")[0]).toEqual({
      key: "housing",
      value: "rent",
      label: "You rent your home",
    });
  });
});

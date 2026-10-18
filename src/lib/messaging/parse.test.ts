import { describe, expect, it } from "vitest";
import { parseReply } from "./parse";

describe("parseReply (spec step 78)", () => {
  it.each(["YES", "yes", "Y", "y", "ok", "OK", "Okay", "👍", "👍🏽", " Yes! ", "yes."])(
    "reads %j as yes",
    (text) => expect(parseReply(text)).toEqual({ kind: "yes" }),
  );

  it.each(["NO", "no", "N", "n", "No."])("reads %j as no", (text) =>
    expect(parseReply(text)).toEqual({ kind: "no" }),
  );

  it.each([
    ["1", [1]],
    ["1 3", [1, 3]],
    ["1,3", [1, 3]],
    ["1, 3", [1, 3]],
    ["3 1", [1, 3]],
    ["1 and 3", [1, 3]],
    ["2 & 4", [2, 4]],
    ["#2", [2]],
    ["1 1 2", [1, 2]],
    ["  2  5  ", [2, 5]],
  ])("reads %j as the numbers %j", (text, numbers) =>
    expect(parseReply(text)).toEqual({ kind: "numbers", numbers }),
  );

  it.each(["UNDO", "undo", "Undo."])("reads %j as undo", (text) =>
    expect(parseReply(text)).toEqual({ kind: "undo" }),
  );

  it.each(["STOP", "stop", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "Stop."])(
    "reads %j as stop",
    (text) => expect(parseReply(text)).toEqual({ kind: "stop" }),
  );

  it("reads START and HELP", () => {
    expect(parseReply("START")).toEqual({ kind: "start" });
    expect(parseReply("start")).toEqual({ kind: "start" });
    expect(parseReply("HELP")).toEqual({ kind: "help" });
    expect(parseReply("help")).toEqual({ kind: "help" });
  });

  it.each([
    "",
    "yes please cancel everything",
    "sure",
    "yes and no",
    "maybe 2",
    "0",
    "1,,3",
    "1-3",
    "123",
    "please stop the gym",
    "no thanks",
    "😀",
    "y e s",
  ])("never acts on free text: %j is other", (text) =>
    expect(parseReply(text)).toEqual({ kind: "other" }),
  );

  it("reads only the start of a very long text", () => {
    expect(parseReply(`${"x".repeat(600)} yes`)).toEqual({ kind: "other" });
  });
});

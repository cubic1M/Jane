import { describe, expect, it } from "vitest";
import { draftFrom, readDraft } from "./signup-draft";

describe("the sign-up draft", () => {
  it("round-trips what was typed, trimmed", () => {
    const form = new FormData();
    form.set("email", "  r207-maya@example.test ");
    form.set("invite", "abcd efgh jkmm");
    expect(readDraft(draftFrom(form))).toEqual({
      email: "r207-maya@example.test",
      invite: "abcd efgh jkmm",
    });
  });

  it("drops anything odd: no cookie, broken JSON, wrong types, too long", () => {
    expect(readDraft(undefined)).toEqual({});
    expect(readDraft("{not json")).toEqual({});
    expect(readDraft(JSON.stringify({ email: 42, invite: ["x"] }))).toEqual({
      email: undefined,
      invite: undefined,
    });
    expect(readDraft(JSON.stringify({ email: `${"a".repeat(250)}@x.io` })).email).toBeUndefined();
  });
});

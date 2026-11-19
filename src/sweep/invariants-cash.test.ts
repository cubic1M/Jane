import { describe, expect, it } from "vitest";
import { sameFigures } from "./invariants";

// Class 4 on the chat's cash answer (debug 3, 11-19): on upload S4 one chat answer gave checking as
// "$3,022.33" (the statement's $3,087.33 walked forward past Verizon's $65 on the 16th, as every
// figure says today's balance, #1099) and "Your cash is $3,087.33" (the cash plan, which read the
// statement's balance). The chat's checking is Home's "In checking now".

const flat = (body: string) => ({
  "home.summary.safeToSpend.balanceCents": 302_233,
  "cash.places.0.name": "Chase Checking",
  "cash.places.0.kind": "checking",
  "cash.places.0.balanceCents": 302_233,
  "cash.places.1.name": "Fidelity Individual cash",
  "cash.places.1.kind": "sweep",
  "cash.places.1.balanceCents": 184_022,
  "chat.how much cash do I have.body": body,
});

describe("checking in the chat's cash answer", () => {
  it("fails when it isn't Home's checking now", () => {
    expect(
      sameFigures(
        flat("Your cash: $3,087.33 in Chase Checking, $1,840.22 in Fidelity Individual cash."),
      ),
    ).toEqual([
      'chat.how much cash do I have.body (checking): "$3087.33", in checking now is 3022.33',
    ]);
  });

  it("passes when it is", () => {
    expect(
      sameFigures(
        flat("Your cash: $3,022.33 in Chase Checking, $1,840.22 in Fidelity Individual cash."),
      ),
    ).toEqual([]);
  });
});

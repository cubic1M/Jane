import { describe, expect, it } from "vitest";
import { hideIn, maskFor, NO_MASK, payeeOf, showIn } from "./payee-mask";

// Beta (11-12): a payment app's payee is a person, and the app's own words have the app taken off
// ("Daniel Smith"), so the chat hides this person's payees from Claude by name and puts them back
// in what the person reads.

describe("a payment app's payee", () => {
  it("is the person, whichever way the money went", () => {
    expect(payeeOf("ZELLE TO DANIEL SMITH ON 10/03 REF # WFCT0ABC")).toBe("Daniel Smith");
    expect(payeeOf("VENMO PAYMENT FROM EMILY ROSE")).toBe("Emily Rose");
    expect(payeeOf("PAYPAL *JANE DOE")).toBe("Jane Doe");
  });

  it("isn't a company, a processor's merchant or a short word", () => {
    expect(payeeOf("PAYPAL *NETFLIX")).toBeNull();
    expect(payeeOf("ZELLE TO OAK RIDGE REALTY")).toBeNull();
    expect(payeeOf("ZELLE FROM MOM")).toBeNull();
  });
});

describe("the mask", () => {
  const mask = maskFor(["Daniel Smith", "Dana Shaw", "Emily"]);

  it("hides each name as a tag, whatever its case, and gives it back", () => {
    const hidden = mask.hide(
      "Your rent goes to Daniel Smith. ZELLE TO DANIEL SMITH. From Dana Shaw.",
    );
    expect(hidden).not.toMatch(/daniel|smith|dana|shaw/i);
    // Two people with the same initials stay apart, with no digit in either tag.
    expect(hidden).toBe("Your rent goes to [person DS]. ZELLE TO [person DS]. From [person DSb].");
    expect(mask.show(hidden)).toBe(
      "Your rent goes to Daniel Smith. ZELLE TO Daniel Smith. From Dana Shaw.",
    );
  });

  it("takes a one-word name only as a name is written, so ordinary words stay", () => {
    expect(mask.hide("Emily paid you; EMILY again")).toBe("[person E] paid you; [person E] again");
    expect(mask.hide("emily")).toBe("emily");
  });

  it("goes through a whole request but leaves files and Claude's signed thinking alone", () => {
    const request = {
      system: [{ type: "text", text: "remembered: Your rent goes to Daniel Smith" }],
      messages: [
        { role: "user", content: "how much did I send Daniel Smith?" },
        {
          role: "assistant",
          content: [{ type: "thinking", thinking: "Daniel Smith", signature: "sig" }],
        },
        { role: "user", content: [{ type: "document", source: { data: "Daniel Smith" } }] },
      ],
    };
    const hidden = hideIn(request, mask);
    expect(hidden.system[0]!.text).toBe("remembered: Your rent goes to [person DS]");
    expect(hidden.messages[0]!.content).toBe("how much did I send [person DS]?");
    expect(JSON.stringify(hidden.messages[1])).toContain('"thinking":"Daniel Smith"');
    expect(JSON.stringify(hidden.messages[2])).toContain('"data":"Daniel Smith"');
    // The request itself is left as it was.
    expect(request.messages[0]!.content).toBe("how much did I send Daniel Smith?");
  });

  it("puts the name back in what a lookup is asked for", () => {
    expect(showIn({ query: "[person DS]", limit: 5 }, mask)).toEqual({
      query: "Daniel Smith",
      limit: 5,
    });
  });

  it("does nothing for someone with no payees", () => {
    expect(maskFor([])).toBe(NO_MASK);
    expect(hideIn({ a: "Daniel Smith" }, NO_MASK)).toEqual({ a: "Daniel Smith" });
  });
});

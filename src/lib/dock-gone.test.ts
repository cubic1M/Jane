import { describe, expect, it } from "vitest";
import { SKIP_SENT, parseSkip, skipParam, withoutGone } from "./dock-gone";

// Founder: "whenever I switch to a page based on the suggestion card's suggestion, the
// suggestion just reappears". The cards dealt with in a tab stay out of every stack.
describe("the cards dealt with in this tab", () => {
  const cards = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("are left out of a stack, in its order", () => {
    expect(withoutGone(cards, ["b"]).map((c) => c.id)).toEqual(["a", "c"]);
    expect(withoutGone(cards, new Set(["a", "c"])).map((c) => c.id)).toEqual(["b"]);
    expect(withoutGone(cards, [""]).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("go to the server as the newest few, and it reads back only plausible ids", () => {
    const many = Array.from({ length: SKIP_SENT + 10 }, (_, i) => `m${i}`);
    const sent = skipParam(many).split(",");
    expect(sent).toHaveLength(SKIP_SENT);
    expect(sent.at(-1)).toBe(`m${SKIP_SENT + 9}`);
    expect([...parseSkip("m1, m2,<script>,,m3")]).toEqual(["m1", "m2", "m3"]);
    expect(parseSkip(null).size).toBe(0);
    expect(parseSkip(many.join(",")).size).toBe(SKIP_SENT);
  });
});

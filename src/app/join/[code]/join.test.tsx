import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { JoinContent, ONE_LINE } from "./join";

const LANDING = {
  inviteId: "inv_1",
  code: "ABCD-EFGH-JKMN",
  card: { kind: "found" as const, dollars: 1200 },
  open: true,
};

const links = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

describe("the invite page", () => {
  it("says what Jane is in one line, with one button into sign-up and the code filled in", () => {
    const html = renderToStaticMarkup(<JoinContent landing={LANDING} />);
    expect(html).toContain(ONE_LINE.replace("'", "&#x27;"));
    expect(html).toContain("Join the beta");
    expect(links(html)).toEqual(["/signup?invite=ABCD-EFGH-JKMN"]);
  });

  it("sends a used-up invite to the waitlist", () => {
    const html = renderToStaticMarkup(<JoinContent landing={{ ...LANDING, open: false }} />);
    expect(html).toContain("used up");
    expect(html).toContain("Join the waitlist");
    expect(links(html)).toEqual(["/signup"]);
  });

  it("sends a wrong link to the waitlist", () => {
    const html = renderToStaticMarkup(<JoinContent landing={null} />);
    expect(html).toContain("isn&#x27;t valid");
    expect(links(html)).toEqual(["/signup"]);
  });
});

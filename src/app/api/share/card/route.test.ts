import { describe, expect, it, vi } from "vitest";

const { ImageResponse } = vi.hoisted(() => ({
  ImageResponse: vi.fn(function (this: Response, element: unknown, init: unknown) {
    return Object.assign(new Response("png"), { element, init });
  }),
}));
vi.mock("next/og", () => ({ ImageResponse }));

import { ShareCardArt } from "@/components/share-card-art";
import { GET } from "./route";

type Drawn = Response & {
  element: { type: unknown; props: { card: unknown } };
  init: { width: number; height: number; headers: Record<string, string> };
};
const get = async (query: string) =>
  (await GET(new Request(`http://localhost/api/share/card${query}`))) as Drawn;

describe("GET /api/share/card", () => {
  it("draws the card in the query at link-preview size, cached", async () => {
    const res = await get("?kind=found&value=1200");
    expect(res.element.type).toBe(ShareCardArt);
    expect(res.element.props.card).toEqual({ kind: "found", dollars: 1200 });
    expect(res.init).toMatchObject({ width: 1200, height: 630 });
    expect(res.init.headers["cache-control"]).toContain("public");
  });

  it("draws a check count", async () => {
    expect((await get("?kind=checked&value=9")).element.props.card).toEqual({
      kind: "checked",
      checks: 9,
    });
  });

  it("draws Jane's plain card for anything else, never the text it was given", async () => {
    for (const query of ["", "?kind=found&value=Netflix", "?kind=account&value=5", "?value=1"]) {
      expect((await get(query)).element.props.card).toBeNull();
    }
  });
});

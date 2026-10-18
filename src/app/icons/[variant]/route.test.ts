import { describe, expect, it } from "vitest";
import { GET } from "./route";

const icon = (variant: string) =>
  GET(new Request(`http://localhost/icons/${variant}`), { params: Promise.resolve({ variant }) });

describe("GET /icons/[variant]", () => {
  it.each(["192", "512", "maskable"])("draws the %s icon as a PNG", async (variant) => {
    const response = await icon(variant);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    const bytes = new Uint8Array(await response.arrayBuffer());
    // The PNG signature.
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("404s for anything else", async () => {
    expect((await icon("huge")).status).toBe(404);
  });
});

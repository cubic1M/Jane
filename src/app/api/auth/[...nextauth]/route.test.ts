import { describe, expect, it, vi } from "vitest";

const { GET, POST } = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));

vi.mock("@/auth", () => ({ handlers: { GET, POST } }));

import * as route from "./route";

describe("/api/auth/[...nextauth]", () => {
  it("hands GET and POST to Auth.js", () => {
    expect(route.GET).toBe(GET);
    expect(route.POST).toBe(POST);
  });
});

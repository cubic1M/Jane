import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/documents/store", () => ({ openDocument: vi.fn(async () => null) }));

import { openDocument } from "@/lib/documents/store";
import { GET } from "./route";

describe("a document id no document has", () => {
  it("is not found, without asking the database", async () => {
    const response = await GET(new NextRequest("http://localhost/api/documents/x"), {
      params: Promise.resolve({ documentId: "abc\u0000def" }),
    });
    expect(response.status).toBe(404);
    expect(openDocument).not.toHaveBeenCalled();
  });
});

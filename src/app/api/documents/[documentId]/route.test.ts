import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/documents/store", () => ({ openDocument: vi.fn() }));

import { openDocument } from "@/lib/documents/store";
import { getCurrentUser } from "@/lib/session";
import { GET } from "./route";

const call = (id: string, query = "") =>
  GET(new NextRequest(`http://localhost/api/documents/${id}${query}`), {
    params: Promise.resolve({ documentId: id }),
  });

describe("GET /api/documents/[documentId] (spec step 68)", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser)
      .mockReset()
      .mockResolvedValue({ id: "u1" } as never);
    vi.mocked(openDocument).mockReset();
  });

  it("refuses visitors who aren't signed in", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await call("d1")).status).toBe(401);
    expect(openDocument).not.toHaveBeenCalled();
  });

  it("answers 404 for another person's document or a missing one", async () => {
    vi.mocked(openDocument).mockResolvedValue(null);
    const response = await call("someone-elses");
    expect(response.status).toBe(404);
    expect(openDocument).toHaveBeenCalledWith("u1", "someone-elses");
  });

  it("serves the owner's file with safe headers", async () => {
    vi.mocked(openDocument).mockResolvedValue({
      fileName: "Policy 2027 – GEICO.pdf",
      contentType: "application/pdf",
      bytes: Buffer.from("%PDF-1.7"),
    });

    const response = await call("d1");

    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("%PDF-1.7");
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toMatch(/^sandbox; default-src 'none'/);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toBe(
      `inline; filename="Policy 2027 _ GEICO.pdf"; filename*=UTF-8''Policy%202027%20%E2%80%93%20GEICO.pdf`,
    );

    const download = await call("d1", "?download=1");
    expect(download.headers.get("content-disposition")).toMatch(/^attachment; /);
  });
});

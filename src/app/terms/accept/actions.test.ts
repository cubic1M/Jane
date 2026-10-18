import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));
vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn(), HOME_PATH: "/connect" }));
vi.mock("@/lib/terms", () => ({ acceptTerms: vi.fn() }));

import { getCurrentUser } from "@/lib/session";
import { acceptTerms } from "@/lib/terms";
import { acceptCurrentTerms } from "./actions";

const form = (consent?: string) => {
  const data = new FormData();
  if (consent) data.set("consent", consent);
  return data;
};

describe("acceptCurrentTerms", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser)
      .mockReset()
      .mockResolvedValue({ id: "u1" } as never);
    vi.mocked(acceptTerms).mockReset();
  });

  it("records acceptance and goes home", async () => {
    await expect(acceptCurrentTerms(form("on"))).rejects.toThrow("redirect:/connect");
    expect(acceptTerms).toHaveBeenCalledWith("u1", { via: "prompt" });
  });

  it("needs the box ticked", async () => {
    await expect(acceptCurrentTerms(form())).rejects.toThrow(
      "redirect:/terms/accept?error=ConsentRequired",
    );
    expect(acceptTerms).not.toHaveBeenCalled();
  });

  it("sends signed-out visitors to sign in", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    await expect(acceptCurrentTerms(form("on"))).rejects.toThrow("redirect:/login");
  });
});

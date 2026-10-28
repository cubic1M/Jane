import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("./fees/body", () => ({ FeesBody: () => null }));
vi.mock("./short-term/body", () => ({ ShortTermBody: () => null }));
vi.mock("./sudden-money/body", () => ({ SuddenMoneyBody: () => null }));
vi.mock("./values/body", () => ({ ValuesBody: () => null }));

import { embedPage } from "./embed-actions";
import { EMBEDDED_PAGES } from "@/config/embedded-pages";
import { isHiddenPage } from "@/config/hidden-pages";
import { requireUser } from "@/lib/session";

describe("opening a sub-page inside the tree", () => {
  beforeEach(() => vi.mocked(requireUser).mockClear());

  it("needs a signed-in person", async () => {
    await embedPage("nothing");
    expect(requireUser).toHaveBeenCalled();
  });
  it("offers nothing for a page that isn't listed", async () => {
    expect(await embedPage("rebalance")).toBeNull();
    expect(await embedPage("../x")).toBeNull();
  });
  it("offers a listed page unless the beta hides it", async () => {
    for (const key of EMBEDDED_PAGES) {
      const node = await embedPage(key);
      expect(node === null).toBe(isHiddenPage(`/investments/${key}`));
    }
  });
});
